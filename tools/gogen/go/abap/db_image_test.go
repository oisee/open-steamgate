//go:build !wasm && !nodatabase

package abap

import "testing"

func TestDBImageKeepsClassWritesPrivate(t *testing.T) {
	seed := []byte(`["CREATE TABLE unit_image (id INTEGER PRIMARY KEY, value TEXT)","INSERT INTO unit_image VALUES (1, 'seed')"]`)
	if err := OpenDB(seed); err != nil {
		t.Fatal(err)
	}
	image, err := DBImage()
	if err != nil {
		t.Fatal(err)
	}
	if err := OpenDBImage(image); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec("INSERT INTO unit_image VALUES (2, 'first class')"); err != nil {
		t.Fatal(err)
	}
	if err := OpenDBImage(image); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := DB().QueryRow("SELECT count(*) FROM unit_image").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("second class has %d rows, want only the seed row", count)
	}
	var value string
	if err := DB().QueryRow("SELECT value FROM unit_image WHERE id = 1").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "seed" {
		t.Fatalf("seed row = %q", value)
	}
}
