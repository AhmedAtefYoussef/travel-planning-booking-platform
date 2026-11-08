# Requirements

- `requirements.json`: every requirement ID from the official workbook (104 mandatory, 11 bonus), generated
  from `Technical Requirements.xlsx`. The workbook stays authoritative; regenerate this file if it changes.
  CI uses it to reject unknown IDs in branch names, PR descriptions and Swagger summaries.
- `traceability.md`: requirement ID -> endpoint(s) -> owner -> Jira key -> status for all 115 IDs. Update your row in the PR that implements it. CI fails if an ID is missing, duplicated or unknown.
