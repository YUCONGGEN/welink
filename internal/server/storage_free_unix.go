//go:build !windows

package server

import "golang.org/x/sys/unix"

func storageFree(path string) (int64, error) {
	var stat unix.Statfs_t
	err := unix.Statfs(path, &stat)
	if err != nil {
		return 0, err
	}
	return int64(stat.Bavail) * int64(stat.Bsize), nil
}
