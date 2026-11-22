; Definition queries for Python (PLAN §4.2). The code index reads its definitions from
; these patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration node, @name its name, and @import an
; import's specifier. When one node is captured by several patterns with the same name,
; the earliest pattern wins, so specific patterns come first. A decorated definition's
; decorators join its citeable span through the decorated_definition wrapper.

; Methods: functions directly in a class body, decorated or not.
(class_definition
  body: (block (function_definition name: (identifier) @name) @definition.method))
(class_definition
  body: (block
    (decorated_definition
      definition: (function_definition name: (identifier) @name) @definition.method)))

; Functions (async included), wherever they are defined, and classes.
(function_definition name: (identifier) @name) @definition.function
(class_definition name: (identifier) @name) @definition.class

; Module-level single-name assignments, annotated or not.
(module (expression_statement (assignment left: (identifier) @name) @definition.variable))

; Imports.
(import_statement name: (dotted_name) @import)
(import_statement name: (aliased_import name: (dotted_name) @import))
(import_from_statement module_name: (_) @import)
