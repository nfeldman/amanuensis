; Definition queries for Java (PLAN §4.2). The code index reads its definitions from these
; patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration node, @name its name, and @import an
; import declaration. Annotations are in a declaration's modifiers and so in its span. A
; method's or constructor's symbol_id appends its parameter types as written.

(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(enum_declaration name: (identifier) @name) @definition.enum
(record_declaration name: (identifier) @name) @definition.record
(annotation_type_declaration name: (identifier) @name) @definition.annotation

(method_declaration name: (identifier) @name) @definition.method
(constructor_declaration name: (identifier) @name) @definition.constructor
(compact_constructor_declaration name: (identifier) @name) @definition.constructor

(field_declaration declarator: (variable_declarator name: (identifier) @name)) @definition.field
(constant_declaration declarator: (variable_declarator name: (identifier) @name)) @definition.field

(import_declaration) @import
