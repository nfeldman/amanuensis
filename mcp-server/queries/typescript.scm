; Definition queries for TypeScript and TSX (PLAN §4.2). The code index reads its
; definitions from these patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration node, @name its name, and @import an
; import's specifier. When one node is captured by several patterns with the same name,
; the earliest pattern wins, so specific patterns come first.

; Functions and generators, wherever they are declared.
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function

; Bodiless declarations: overload signatures and ambient functions. Each shares its
; implementation's identity and is a further occurrence of it.
(function_signature name: (identifier) @name) @definition.declaration
(class_body (method_signature name: (_) @name) @definition.declaration)

; Classes and their members.
(class_declaration name: (type_identifier) @name) @definition.class
(abstract_class_declaration name: (type_identifier) @name) @definition.class
(class_body (method_definition "get" name: (_) @name) @definition.getter)
(class_body (method_definition "set" name: (_) @name) @definition.setter)
(class_body
  (method_definition name: (property_identifier) @name) @definition.constructor
  (#eq? @name "constructor"))
(class_body (method_definition name: (_) @name) @definition.method)
(class_body (abstract_method_signature name: (_) @name) @definition.method)
(class_body (public_field_definition name: (_) @name) @definition.field)

; Types.
(interface_declaration name: (type_identifier) @name) @definition.interface
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(internal_module name: (_) @name) @definition.namespace
(module name: (_) @name) @definition.namespace

; Top-level declarators: in the program or directly in a namespace body.
(program
  [(lexical_declaration (variable_declarator name: (identifier) @name))
   (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable)
(program
  [(export_statement
     declaration: [(lexical_declaration (variable_declarator name: (identifier) @name))
                   (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable)
   (ambient_declaration
     [(lexical_declaration (variable_declarator name: (identifier) @name))
      (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable)])
(internal_module
  body: (statement_block
    [(lexical_declaration (variable_declarator name: (identifier) @name))
     (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable))
(internal_module
  body: (statement_block
    (export_statement
      declaration: [(lexical_declaration (variable_declarator name: (identifier) @name))
                    (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable)))
(module
  body: (statement_block
    [(lexical_declaration (variable_declarator name: (identifier) @name))
     (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable))
(module
  body: (statement_block
    (export_statement
      declaration: [(lexical_declaration (variable_declarator name: (identifier) @name))
                    (variable_declaration (variable_declarator name: (identifier) @name))] @definition.variable)))

; A default export of an expression: `export default {...}`, `export default function () {}`.
; A named declaration under `export default` is defined by its own pattern above.
(export_statement value: (_)) @definition.default

; Imports.
(import_statement source: (string (string_fragment) @import))
(export_statement source: (string (string_fragment) @import))
((call_expression
   function: (identifier) @_require
   arguments: (arguments . (string (string_fragment) @import) .))
  (#eq? @_require "require"))
(call_expression
  function: (import)
  arguments: (arguments . (string (string_fragment) @import)))
