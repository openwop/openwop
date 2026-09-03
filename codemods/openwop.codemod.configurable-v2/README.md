# openwop.codemod.configurable-v2

RFC 0171 §D.1 / row `C4.12`: rewrites a v1 `configurable` open map into the closed, nested, versioned v2 object. Reserved keys move to `run` / `ai` / `distillation` / `budget`; dotted `ai.*` and `distillation.*` keys nest; vendor `<org>.<name>` keys move under `extensions.<org>`; an unknown undotted key is refused. Negative control: a v2 object is unchanged. Idempotent.
