// Package enqseam adapts generated ENQUEUE and DEQUEUE calls to hostclass.
package enqseam

import (
	"strconv"
	"strings"
	"time"

	"osg/gogen/abap"
	"osg/gogen/enq"
	"osg/gogen/yieldsleep"
)

// Enqueue calls a non-nil KERNEL_LOCK Enqueue hook.
func Enqueue(s *abap.Session, table, object string, args map[string]abap.Data,
	hook func(any, enq.Request, func(time.Duration)) (enq.Result, error)) {
	if hook == nil {
		panic(abap.NotCompiled("CALL FUNCTION 'ENQUEUE_"+object+"'", "no host implementation of this function module"))
	}
	r := Request(s, table, object, args)
	if flag(args, "_COLLECT") {
		raise(s, object, "SYSTEM_FAILURE", "", "")
	}
	var sleep func(time.Duration)
	if flag(args, "_WAIT") {
		sleep = func(d time.Duration) { yieldsleep.Sleep(s, d) }
	}
	result, err := hook(s, r, sleep)
	if err != nil {
		panic(err)
	}
	switch result.Subrc {
	case 0:
		s.Sy.Subrc = 0
	case 1:
		raise(s, object, "FOREIGN_LOCK", result.Msgno, result.Holder)
	default:
		raise(s, object, "SYSTEM_FAILURE", "", "")
	}
}

// Dequeue calls a non-nil KERNEL_LOCK Dequeue hook.
func Dequeue(s *abap.Session, table, object string, args map[string]abap.Data,
	hook func(any, enq.Request) error) {
	if hook == nil {
		panic(abap.NotCompiled("CALL FUNCTION 'DEQUEUE_"+object+"'", "no host implementation of this function module"))
	}
	if err := hook(s, Request(s, table, object, args)); err != nil {
		panic(err)
	}
	s.Sy.Subrc = 0
}

// DequeueAll calls a non-nil KERNEL_LOCK DequeueAll hook.
func DequeueAll(s *abap.Session, hook func(any) error) {
	if hook == nil {
		panic(abap.NotCompiled("CALL FUNCTION 'DEQUEUE_ALL'", "no host implementation of this function module"))
	}
	if err := hook(s); err != nil {
		panic(err)
	}
	s.Sy.Subrc = 0
}

// Request builds the lock argument exactly as the JavaScript host's request()
// does: the lock table's key order, the client removed, initial key values
// generic unless X_<field> says otherwise, and the DDIC length carried on.
func Request(s *abap.Session, table, object string, args map[string]abap.Data) enq.Request {
	t, ok := abap.TableByName(table)
	if !ok {
		panic(abap.NotCompiled("ENQUEUE_"+object, "table "+strings.ToUpper(table)+" is not in the dictionary"))
	}
	r := enq.Request{Table: strings.ToUpper(t.Name), Object: strings.ToUpper(object)}
	for _, name := range t.Key {
		if name == "MANDT" || name == "CLIENT" {
			if value, ok := args["MANDT"]; ok {
				r.Client = strings.TrimSpace(abap.FmtData(value))
			} else if value, ok := args["CLIENT"]; ok {
				r.Client = strings.TrimSpace(abap.FmtData(value))
			}
			if r.Client == "" && s != nil {
				r.Client = abap.Mandt
			}
			continue
		}
		column, ok := t.Column(name)
		if !ok {
			panic(abap.NotCompiled("ENQUEUE_"+object, "lock key "+name+" is not a column of "+r.Table))
		}
		field := enq.Field{Length: column.Len}
		if value, ok := args[name]; ok {
			field.Value = strings.TrimRight(abap.FmtData(value), " ")
		}
		field.Generic = initial(field.Value, column.Kind) && !flag(args, "X_"+name)
		r.Fields = append(r.Fields, field)
	}
	if mode, ok := args["MODE_"+r.Table]; ok {
		r.Mode = strings.ToUpper(strings.TrimSpace(abap.FmtData(mode)))
	}
	if r.Mode == "" {
		r.Mode = "E"
	}
	if scope, ok := args["_SCOPE"]; ok {
		if text := strings.TrimSpace(abap.FmtData(scope)); text != "" {
			parsed, err := strconv.Atoi(text)
			if err != nil {
				panic(abap.NotCompiled("ENQUEUE_"+object, "_SCOPE "+text+" is not a number"))
			}
			r.Scope = parsed
		}
	}
	if r.Scope == 0 {
		r.Scope = 2
	}
	return r
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

func flag(args map[string]abap.Data, name string) bool {
	value, ok := args[name]
	return ok && strings.EqualFold(strings.TrimSpace(abap.FmtData(value)), "X")
}

func raise(s *abap.Session, object, name, msgno, holder string) {
	if msgno != "" {
		s.Sy.Msgid = "MC"
		s.Sy.Msgty = "E"
		s.Sy.Msgno = abap.CToN(msgno, 3)
		s.Sy.Msgv1 = abap.CFit(holder, 50)
	}
	panic(abap.ClassicException{Name: name, Method: "ENQUEUE_" + strings.ToUpper(object)})
}
