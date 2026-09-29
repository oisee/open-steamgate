//go:build nodatabase

package abap

import (
	"database/sql"
	"errors"
)

// Native command builds do not carry a database driver. Reports which never
// issue Open SQL stay small; one which does gets an explicit host error.
func openSQL(string) (*sql.DB, error) {
	return nil, errors.New("no database in this native command build")
}
