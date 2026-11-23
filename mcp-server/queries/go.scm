; Definition queries for Go (PLAN §4.2). The code index reads its definitions from these
; patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration node, @name its name, and @import an
; import's specifier. A spec in an unparenthesized declaration (`type A struct{}`,
; `const Pi = 3.14`) is cited as the whole declaration; one in a group as itself. A
; method's qname is <Receiver>.<name>, read from the receiver by the extractor.

(function_declaration name: (identifier) @name) @definition.function
(method_declaration name: (field_identifier) @name) @definition.method

; Type specs and aliases, wherever they are declared.
(type_declaration (type_spec name: (type_identifier) @name) @definition.type)
(type_declaration (type_alias name: (type_identifier) @name) @definition.type)

; Top-level consts and vars.
(source_file (const_declaration (const_spec name: (identifier) @name) @definition.const))
(source_file (var_declaration (var_spec name: (identifier) @name) @definition.var))
(source_file
  (var_declaration (var_spec_list (var_spec name: (identifier) @name) @definition.var)))

; Imports.
(import_spec path: (interpreted_string_literal (interpreted_string_literal_content) @import))
(import_spec path: (raw_string_literal (raw_string_literal_content) @import))
