; Definition queries for C# (PLAN §4.2). The code index reads its definitions from these
; patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration, @name its name, and @import a using
; directive's namespace. Attributes and accessors are inside a declaration and so in its
; span. Local functions are statements, not definitions, and no pattern captures them. The
; extractor appends generic arity to type and method segments of a symbol_id, a member's
; parameter types with their modifiers, and marks a partial type's declaration a fragment;
; a partial method without a body is kind `declaration`.

; Namespaces, block and file-scoped.
(namespace_declaration name: (_) @name) @definition.namespace
(file_scoped_namespace_declaration name: (_) @name) @definition.namespace

; Types.
(class_declaration name: (identifier) @name) @definition.class
(struct_declaration name: (identifier) @name) @definition.struct
(interface_declaration name: (identifier) @name) @definition.interface
(record_declaration name: (identifier) @name) @definition.record
(enum_declaration name: (identifier) @name) @definition.enum
(delegate_declaration name: (identifier) @name) @definition.delegate

; Members.
(method_declaration name: (identifier) @name) @definition.method
(constructor_declaration name: (identifier) @name) @definition.constructor
(destructor_declaration name: (identifier) @name) @definition.destructor
(operator_declaration) @definition.operator
(conversion_operator_declaration) @definition.operator
(indexer_declaration) @definition.indexer
(property_declaration name: (identifier) @name) @definition.property
(event_declaration name: (identifier) @name) @definition.event
(event_field_declaration
  (variable_declaration (variable_declarator name: (identifier) @name))) @definition.event
(field_declaration
  (modifier) @const
  (variable_declaration (variable_declarator name: (identifier) @name))
  (#eq? @const "const")) @definition.const
(field_declaration
  (variable_declaration (variable_declarator name: (identifier) @name))) @definition.field

; Imports.
(using_directive (_) @import)
