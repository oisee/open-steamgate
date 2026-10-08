// Package enqseam adapts generated ENQUEUE and DEQUEUE calls to hostclass.
package enqseam

import (
	"strconv"
	"strings"
	"time"

	"osg/gogen/enq"
	"osg/gogen/yieldsleep"
)

// Args are the call's scalar parameters, already formatted by generated code.
type Args map[string]string

// Field is one DDIC key field of a lock table.
type Field struct {
	Name   string
	Kind   byte
	Length int
}

// Table is the lock table metadata generated from the dictionary.
type Table struct {
	Name string
	Key  []Field
}

// Session is the narrow runtime boundary this package needs. Generated code
// passes *abap.Session; the import stays in generated code, not here.
type Session interface {
	EnqClient() string
	EnqSetSubrc(int32)
	EnqRefuse(call, why string)
	EnqRaise(object, name, msgno, holder string)
}

// Enqueue calls a non-nil KERNEL_LOCK Enqueue hook.
func Enqueue(step any, table Table, object string, args Args,
	hook func(any, enq.Request, func(time.Duration)) (enq.Result, error)) {
	s := session(step)
	if hook == nil {
		s.EnqRefuse("CALL FUNCTION 'ENQUEUE_"+strings.ToUpper(object)+"'", "no host implementation of this function module")
	}
	r := Request(s, table, object, args)
	if flag(args, "_COLLECT") {
		s.EnqRaise(object, "SYSTEM_FAILURE", "", "")
	}
	var sleep func(time.Duration)
	if flag(args, "_WAIT") {
		sleep = func(d time.Duration) { yieldsleep.Sleep(step, d) }
	}
	result, err := hook(step, r, sleep)
	if err != nil {
		panic(err)
	}
	switch result.Subrc {
	case 0:
		s.EnqSetSubrc(0)
	case 1:
		s.EnqRaise(object, "FOREIGN_LOCK", result.Msgno, result.Holder)
	default:
		s.EnqRaise(object, "SYSTEM_FAILURE", "", "")
	}
}

// Dequeue calls a non-nil KERNEL_LOCK Dequeue hook.
func Dequeue(step any, table Table, object string, args Args,
	hook func(any, enq.Request) error) {
	s := session(step)
	if hook == nil {
		s.EnqRefuse("CALL FUNCTION 'DEQUEUE_"+strings.ToUpper(object)+"'", "no host implementation of this function module")
	}
	if err := hook(step, Request(s, table, object, args)); err != nil {
		panic(err)
	}
	s.EnqSetSubrc(0)
}

// DequeueAll calls a non-nil KERNEL_LOCK DequeueAll hook.
func DequeueAll(step any, hook func(any) error) {
	s := session(step)
	if hook == nil {
		s.EnqRefuse("CALL FUNCTION 'DEQUEUE_ALL'", "no host implementation of this function module")
	}
	if err := hook(step); err != nil {
		panic(err)
	}
	s.EnqSetSubrc(0)
}

// Request builds the lock argument exactly as the JavaScript host's request()
// does: key order, generic initial values, DDIC lengths, mode and scope.
func Request(s Session, table Table, object string, args Args) enq.Request {
	r := enq.Request{Table: strings.ToUpper(table.Name), Object: strings.ToUpper(object)}
	for _, key := range table.Key {
		name := strings.ToUpper(key.Name)
		if name == "MANDT" || name == "CLIENT" {
			if value, ok := args["MANDT"]; ok {
				r.Client = strings.TrimSpace(value)
			} else if value, ok := args["CLIENT"]; ok {
				r.Client = strings.TrimSpace(value)
			}
			if r.Client == "" && s != nil {
				r.Client = s.EnqClient()
			}
			continue
		}
		field := enq.Field{Length: key.Length, Value: strings.TrimRight(args[name], " ")}
		field.Generic = initial(field.Value, key.Kind) && !flag(args, "X_"+name)
		r.Fields = append(r.Fields, field)
	}
	if mode, ok := args["MODE_"+r.Table]; ok {
		r.Mode = strings.ToUpper(strings.TrimSpace(mode))
	}
	if r.Mode == "" {
		r.Mode = "E"
	}
	if scope, ok := args["_SCOPE"]; ok {
		if text := strings.TrimSpace(scope); text != "" {
			parsed, err := strconv.Atoi(text)
			if err != nil {
				s.EnqRefuse("ENQUEUE_"+r.Object, "_SCOPE "+text+" is not a number")
			}
			r.Scope = parsed
		}
	}
	if r.Scope == 0 {
		r.Scope = 2
	}
	return r
}

func session(step any) Session {
	s, ok := step.(Session)
	if !ok {
		panic("ENQUEUE call without an ABAP Session")
	}
	return s
}

func initial(value string, kind byte) bool {
	if strings.TrimSpace(value) == "" {
		return true
	}
	if kind != 'I' && kind != '8' && kind != 'F' && kind != 'P' && kind != 'N' {
		return false
	}
	for _, c := range strings.TrimSpace(value) {
		if !strings.ContainsRune("0.,+-", c) {
			return false
		}
	}
	return true
}

func flag(args Args, name string) bool {
	value, ok := args[name]
	return ok && strings.EqualFold(strings.TrimSpace(value), "X")
}
