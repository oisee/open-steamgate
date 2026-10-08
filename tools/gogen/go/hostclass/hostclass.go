// Package hostclass exposes host replacements for selected generated ABAP
// classes. Generated code keeps the ABAP fallback and only consults these
// hooks when a host installs one.
package hostclass

// Raise asks generated code to raise an ABAP exception via the required
// static Factory on Class. Text is only diagnostic text for Error(); it is
// never used to construct the exception.
type Raise struct {
	Class   string
	Factory string
	Text    string
}

func (e *Raise) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.Text == "" {
		return e.Class
	}
	return e.Class + ": " + e.Text
}

// ZCL_OSD_ENQ_KERNEL contains one field per replaced method. A second
// replaced class gets its own named variable beside this one.
var ZCL_OSD_ENQ_KERNEL = struct {
	Bind         func(id, user string) (bool, error)
	End          func(id string) error
	Revive       func(id string) error
	ContextAlive func(id string) (bool, error)
	Owns         func(id string) (bool, error)
	SessionID    func(id string) (string, error)
}{}
