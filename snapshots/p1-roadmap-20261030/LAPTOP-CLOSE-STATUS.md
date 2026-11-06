# Laptop-close status — P1 High freezes

**Written:** 2026-11-02T22:56+01:00  
**Verdict:** 15814 batch complete. Local quiet grind owns **15902** on Spock.

## Where the grind lives now

| Item | Value |
|------|--------|
| Host | **Spock** `tim@10.0.0.10` |
| Live probe | High **django-15902** (+ 15996/16041 until +1 resolve or 3 fails) |
| Queue script | `/tmp/p1-grind-15902.sh` (setsid/nohup) |
| State / logs | `/tmp/p1-grind-15902/` |
| Start scores | B-04 **26/27** · B-05 **4/22** · Lite **68/296** |
| Model | `gpt-oss-20b` · think=`high` |
| LiteLLM | Spock `127.0.0.1:24001` → Spark |

## Prior 15814 batch (bfc85912)

- **Complete** 2026-11-02T22:52+01:00 → unique **26/27**, B-05 **4/22**.
- Private `7d734908` · OSS `0b3a380f`.
