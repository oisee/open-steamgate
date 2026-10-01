package abap

import (
	"errors"
	"io"
	"os"
	"strings"
)

// The native command's frontend is its local process. These functions back
// the useful, non-dialog subset of CL_GUI_FRONTEND_SERVICES.

func FrontendTempDirectory(_ *Session, result *string) {
	*result = os.TempDir()
}

func FrontendCurrentDirectory(_ *Session, result *string) {
	dir, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	*result = dir
}

func FrontendGetenv(_ *Session, name string) string {
	return os.Getenv(strings.TrimSpace(name))
}

func FrontendFileExist(_ *Session, name string) string {
	info, err := os.Stat(name)
	if err == nil && !info.IsDir() {
		return "X"
	}
	return ""
}

func FrontendDirectoryExist(_ *Session, name string) string {
	info, err := os.Stat(name)
	if err == nil && info.IsDir() {
		return "X"
	}
	return ""
}

func FrontendFileSize(_ *Session, name string, result *int32) {
	info, err := os.Stat(name)
	if err != nil {
		panic(err)
	}
	if info.Size() > 1<<31-1 {
		panic(ArithmeticError{Class: "CX_SY_CONVERSION_OVERFLOW", Op: "CL_GUI_FRONTEND_SERVICES=>FILE_GET_SIZE"})
	}
	*result = int32(info.Size())
}

func FrontendUpload(_ *Session, filename, filetype string, length *int32, header *string, table *Data) {
	sb := frontendSandbox()
	if _, info, err := sb.BrowseEntry(filename, false); err != nil || !info.Mode().IsRegular() {
		panic(os.ErrPermission)
	}
	h, reason := sb.Open(filename, DatasetInput)
	if h == nil {
		panic(errors.New(reason))
	}
	defer h.Close()
	size, err := h.Size()
	if err != nil {
		panic(err)
	}
	if size > 1<<31-1 {
		panic(ArithmeticError{Class: "CX_SY_CONVERSION_OVERFLOW", Op: "CL_GUI_FRONTEND_SERVICES=>GUI_UPLOAD"})
	}
	content, err := h.ReadAt(0, int(size))
	if err != nil && err != io.EOF {
		panic(err)
	}
	if len(content) > 1<<31-1 {
		panic(ArithmeticError{Class: "CX_SY_CONVERSION_OVERFLOW", Op: "CL_GUI_FRONTEND_SERVICES=>GUI_UPLOAD"})
	}
	*length, *header = int32(len(content)), ""
	ClearData(*table)
	if strings.EqualFold(strings.TrimSpace(filetype), "BIN") {
		appendBinary(*table, content)
		return
	}
	text := strings.ReplaceAll(string(content), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	for _, line := range lines {
		value := line
		AppendData(*table, Data{P: &value, T: TString})
	}
}

func appendBinary(table Data, content []byte) {
	if table.T == nil || table.T.Kind != 'h' || table.T.Append == nil {
		panic(NotCompiled("CL_GUI_FRONTEND_SERVICES=>GUI_UPLOAD", "binary target is not a standard table"))
	}
	rowType := table.T.Row
	width := rowType.Len
	if rowType.Kind == 'y' {
		width = len(content)
	}
	if width <= 0 {
		panic(NotCompiled("CL_GUI_FRONTEND_SERVICES=>GUI_UPLOAD", "binary target row is not byte-like"))
	}
	for offset := 0; offset < len(content); offset += width {
		end := min(len(content), offset+width)
		row := table.T.Append(table.P)
		value := string(content[offset:end])
		switch rowType.Kind {
		case 'X':
			*row.(*string) = XFit(value, rowType.Len)
		case 'y':
			*row.(*string) = value
		default:
			panic(NotCompiled("CL_GUI_FRONTEND_SERVICES=>GUI_UPLOAD", "binary target row is not x or xstring"))
		}
	}
}

func FrontendDownload(_ *Session, filename, filetype string, binSize int32, writeLF, appendFlag string, table Data) {
	var content []byte
	if strings.EqualFold(strings.TrimSpace(filetype), "BIN") {
		for i := 0; i < Lines(table); i++ {
			row := Row(table, i)
			if row.T.Kind != 'X' && row.T.Kind != 'y' {
				panic(NotCompiled("CL_GUI_FRONTEND_SERVICES=>GUI_DOWNLOAD", "binary source row is not x or xstring"))
			}
			content = append(content, []byte(*row.P.(*string))...)
		}
		if binSize > 0 && int(binSize) < len(content) {
			content = content[:binSize]
		}
	} else {
		lines := make([]string, Lines(table))
		for i := range lines {
			lines[i] = strings.TrimRight(DataString(Row(table, i)), " ")
		}
		separator := "\n"
		if strings.TrimSpace(writeLF) == "" {
			separator = ""
		}
		content = []byte(strings.Join(lines, separator))
		if separator != "" && len(lines) > 0 {
			content = append(content, '\n')
		}
	}
	sb := frontendSandbox()
	mode := DatasetOutput
	if strings.TrimSpace(appendFlag) == "X" {
		mode = DatasetAppending
	}
	h, reason := sb.Open(filename, mode)
	if h == nil {
		panic(errors.New(reason))
	}
	pos := int64(0)
	if mode == DatasetAppending {
		var err error
		pos, err = h.Size()
		if err != nil {
			h.Close()
			panic(err)
		}
	}
	if err := h.WriteAt(pos, content); err != nil {
		h.Close()
		panic(err)
	}
	if err := h.Close(); err != nil {
		panic(err)
	}
}

func frontendSandbox() *Sandbox {
	if sb, ok := currentDatasetHost().(*Sandbox); ok {
		return sb
	}
	return SandboxFromEnv()
}
