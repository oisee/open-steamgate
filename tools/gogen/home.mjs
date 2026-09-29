// The checkout that holds packs/, .local/lars/ and the .local/ recordings:
// OSG_HOME, else OSD_ROOT (the convention the other tools follow), else the
// working directory.
//
// It used to be the directory above `git rev-parse --git-common-dir`. In a
// git worktree that is the MAIN checkout, not the worktree, so a parity run
// in a worktree read the main checkout's gen/ and compared the wrong build
// without saying so. No git call and no path off import.meta: the caller
// says where it is.
export const home = process.env.OSG_HOME ?? process.env.OSD_ROOT ?? process.cwd();
