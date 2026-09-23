package abap

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

// The identity and the clock of this system as sy shows them (the Node boot
// sets the same from tools/osd-identity.mjs), and what ZCL_OSD_SYSINFO's
// environment tab says about the host.

var (
	SysID = "OSG"
	UName = "DEVELOPER"
	// HostFacts are lines "name\tvalue" a host adds (its database, the build)
	HostFacts []string
	started   = time.Now()
)

func Datum() string { return time.Now().UTC().Format("20060102") }
func Uzeit() string { return time.Now().UTC().Format("150405") }

// SysInfoEnv is ZCL_OSD_SYSINFO=>ENVIRONMENT: one "name\tvalue" line each.
func SysInfoEnv(s *Session) string {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	up := time.Since(started).Round(time.Second)
	lines := []string{
		"runtime\tABAP compiled to Go (abap-go, tools/gogen)",
		"go\t" + runtime.Version(),
		"platform\t" + runtime.GOOS + "/" + runtime.GOARCH,
		fmt.Sprintf("cpus\t%d", runtime.NumCPU()),
		fmt.Sprintf("process\t%d", os.Getpid()),
		"started\t" + started.UTC().Format("2006-01-02 15:04:05") + " UTC",
		"uptime\t" + up.String(),
		fmt.Sprintf("memory\t%.1f MB from the OS, %.1f MB heap in use", float64(m.Sys)/1048576, float64(m.HeapAlloc)/1048576),
		fmt.Sprintf("goroutines\t%d", runtime.NumGoroutine()),
	}
	lines = append(lines, HostFacts...)
	return strings.Join(lines, "\n")
}
