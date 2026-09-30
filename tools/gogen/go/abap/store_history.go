package abap

import (
	"bytes"
	"fmt"
	osexec "os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// StoreRevision is one version of an object: a commit that changed its file
// (ZOSD_REVISION_S), as tools/osd-store-destination.mjs answers HISTORY.
type StoreRevision struct {
	REVISION, SHORT, AUTHOR, DATE, TIME, SUBJECT string
	path                                         string
}

func storeGit(root string, args ...string) (string, error) {
	cmd := osexec.Command("git", args...)
	cmd.Dir = root
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return out.String(), nil
}

var storeNotUser = regexp.MustCompile(`[^A-Za-z0-9_]`)

// storeSapUser is a git author as a SAP user name: upper case, A-Z 0-9 _,
// at most 12, never an e-mail (the Node host's sapUserOf). Non-ASCII is
// dropped before upper-casing, since JS and Go upper-case it differently.
func storeSapUser(author string) string {
	u := strings.ToUpper(storeNotUser.ReplaceAllString(author, ""))
	if len(u) > 12 {
		u = u[:12]
	}
	if u == "" {
		return "UNKNOWN"
	}
	return u
}

// storeHistory is gitObjectHistory of tools/osd-git-history.mjs: the commits
// that changed file, newest first, along the first-parent line (a merge by
// its first-parent diff),
// followed across renames and cut at a copy. The reason is
// set, and the list nil, when git has no history for it.
func storeHistory(root, file string, limit int) ([]StoreRevision, string) {
	if out, err := storeGit(root, "rev-parse", "--is-inside-work-tree"); err != nil || strings.TrimSpace(out) != "true" {
		return nil, "the object store is not inside a git worktree"
	}
	if _, err := storeGit(root, "rev-parse", "HEAD"); err != nil {
		return nil, "git history is unavailable for this object store"
	}
	if _, err := storeGit(root, "ls-files", "--error-unmatch", "--", file); err != nil {
		return nil, file + " is not tracked by git"
	}
	out, err := storeGit(root, "--literal-pathspecs", "-c", "core.quotePath=false", "log", "--follow",
		"--first-parent", "--diff-merges=first-parent", "--name-status", "-n", strconv.Itoa(limit),
		"--format=%x1e%H%x00%aN%x00%aI%x00%s", "HEAD", "--", file)
	if err != nil {
		return nil, "git history is unavailable for this object store"
	}
	revs := []StoreRevision{}
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		lines := strings.Split(rec, "\n")
		f := strings.SplitN(lines[0], "\x00", 4)
		if len(f) < 4 {
			continue
		}
		last := ""
		for _, l := range lines[1:] {
			if l = strings.TrimSpace(l); l != "" {
				last = l
			}
		}
		change := strings.Split(last, "\t")
		// a D is --follow's old name leaving; there is no version to read there
		if strings.HasPrefix(change[0], "D") {
			continue
		}
		path := file
		if len(change) > 1 {
			path = change[len(change)-1]
		}
		r := StoreRevision{REVISION: f[0], AUTHOR: storeSapUser(f[1]), SUBJECT: f[3], DATE: "00000000", TIME: "000000", path: path}
		r.SHORT = r.REVISION
		if len(r.SHORT) > 12 {
			r.SHORT = r.SHORT[:12]
		}
		if len([]rune(r.SUBJECT)) > 80 {
			r.SUBJECT = string([]rune(r.SUBJECT)[:80])
		}
		if t, err := time.Parse(time.RFC3339, f[2]); err == nil {
			u := t.UTC()
			r.DATE, r.TIME = u.Format("20060102"), u.Format("150405")
		}
		revs = append(revs, r)
		// --follow also follows a copy; what came before it is another
		// object's history, so the object's own history begins at the copy
		if strings.HasPrefix(change[0], "C") {
			break
		}
	}
	if len(revs) == 0 {
		// added to the index and never committed: tracked, and still no version
		return nil, file + " has no commit yet"
	}
	return revs, ""
}

var storeFullSha = regexp.MustCompile(`^[0-9a-f]{40}$`)

// storeRevisionAt is gitObjectRevisionAt: the file's source at one of its
// versions, read at the path it had in that commit.
func storeRevisionAt(root, file, revision string) (source, path string, err error) {
	wanted := strings.ToLower(revision)
	if !storeFullSha.MatchString(wanted) {
		return "", "", storeRefusal("A git revision must be a full 40-character commit SHA.")
	}
	revs, reason := storeHistory(root, file, 100000)
	if reason != "" {
		return "", "", storeRefusal(reason)
	}
	for _, r := range revs {
		if r.REVISION == wanted {
			out, err := storeGit(root, "show", "--no-textconv", wanted+":"+r.path)
			if err != nil {
				return "", "", storeRefusal(err.Error())
			}
			return out, r.path, nil
		}
	}
	return "", "", storeRefusal(fmt.Sprintf("Revision %s is not a version of %s.", wanted[:12], file))
}
