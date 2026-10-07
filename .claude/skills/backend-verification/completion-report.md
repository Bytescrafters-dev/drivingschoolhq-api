# Completion report template

Use concise, factual wording:

```markdown
Implemented
- [change and owning domain]

Design / data
- [notable boundary, transaction or migration decision]

Tests and verification
- `actual command` — passed / failed (summary)
- `actual command` — passed / failed (summary)
- [not run: reason, impact]

Files / migrations
- [affected areas]

Remaining risks
- [precise issue or none identified within tested scope]
```

Do **not** say "all tests pass" if only a filtered subset ran. Do **not** say "migration tested" when SQL was only inspected. If the task is blocked by repository/test-environment access, report what you implemented and the exact unverified boundary.
