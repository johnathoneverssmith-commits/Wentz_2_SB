Implement only the accepted plan in the provided ephemeral checkout. Preserve
approved requirements and acceptance tests. Edit only the planned, allowed files.
Do not run shell commands, change control files, merge, deploy, or read credentials.
Return the implementation JSON contract. Use the provided baseline as headSha;
the trusted publisher constructs the actual immutable head from captured files.
CI runs separately without credentials. Summaries and claimed diffs are checked
against actual files; never claim tests passed without independent evidence.
