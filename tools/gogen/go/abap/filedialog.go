package abap

import (
	"path/filepath"
	"reflect"
	"strings"
	"unsafe"
)

// FrontendPick is installed only while a terminal selection form is active.
// Outside that form (including batch and SAP GUI) dialogs refuse explicitly.
var FrontendPick func(kind, initial, name, title string) (string, error)

func frontendPick(kind, initial, name, title string) (string, bool) {
	if FrontendPick == nil {
		panic(NotCompiled("F4 file dialog", "available only in the terminal selection screen; SAP GUI F4 is not supported"))
	}
	path, err := FrontendPick(kind, initial, name, title)
	return path, err == nil && path != ""
}

func FrontendFileOpenDialog(_ *Session, title, name, initial string, table any, rc, action *int32) {
	*rc, *action = 0, 9
	rows := reflect.ValueOf(table).Elem()
	rows.Set(reflect.MakeSlice(rows.Type(), 0, 1))
	path, ok := frontendPick("open", initial, name, title)
	if !ok {
		return
	}
	row := reflect.New(rows.Type().Elem()).Elem()
	field := row.FieldByName("filename")
	// The generated FILE_TABLE field follows ABAP's lowercase naming. The
	// typed generated package cannot be imported here, so set this one field.
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().SetString(path)
	rows.Set(reflect.Append(rows, row))
	*rc, *action = 1, 0
}

func FrontendFileSaveDialog(_ *Session, title, name, initial string, filename, dir, fullpath *string, action *int32) {
	*action = 9
	path, ok := frontendPick("save", initial, name, title)
	if !ok {
		return
	}
	*filename, *dir, *fullpath, *action = filepath.Base(path), filepath.Dir(path), path, 0
}

func FrontendDirectoryBrowse(_ *Session, title, initial string, selected *string) {
	path, ok := frontendPick("directory", initial, "", title)
	if ok {
		*selected = path
	}
}

func F4_FILENAME(_ *Session, args map[string]Data) {
	path, ok := frontendPick("open", "", "", "")
	if !ok {
		return
	}
	if target, exists := args["FILE_NAME"]; exists {
		MoveData(target, Data{P: &path, T: TString})
	}
}

func KD_GET_FILENAME_ON_F4(_ *Session, args map[string]Data) {
	target, exists := args["FILE_NAME"]
	if !exists {
		return
	}
	path, ok := frontendPick("open", "", strings.TrimSpace(DataString(target)), "")
	if ok {
		MoveData(target, Data{P: &path, T: TString})
	}
}
