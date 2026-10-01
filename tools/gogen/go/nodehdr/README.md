# nodehdr

Node IncomingMessage duplicate-header rule shared by server and client.
`FirstWins` lists headers that keep their first value.
`Merge` joins cookie with `; ` and other repeatable headers with `, `.
Callers retain the special Set-Cookie array representation.
