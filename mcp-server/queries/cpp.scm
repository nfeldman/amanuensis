; Definition queries for C++ (PLAN §4.2). The code index reads its definitions from these
; patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration, @name its declarator or name, and
; @import an include's path. The extractor reads the name inside pointer, reference and
; function declarators and refines kinds the query cannot see: a function definition is a
; method, constructor, destructor or operator by its name and scope, and a declaration or
; member whose declarator is a function's is kind `declaration`. Declarations outside a
; namespace or class (locals) are dropped. `template` wrappers join a citeable span.

; Function definitions, in and out of class.
(function_definition declarator: (_) @name) @definition.function

; Namespaces, classes, structs, unions and enums with a body.
(namespace_definition name: (_) @name) @definition.namespace
(class_specifier name: (_) @name body: (_)) @definition.class
(struct_specifier name: (_) @name body: (_)) @definition.struct
(union_specifier name: (_) @name body: (_)) @definition.union
(enum_specifier name: (_) @name body: (_)) @definition.enum

; Members: fields, and member function declarations without a body.
(field_declaration declarator: (_) @name) @definition.field

; Declarations: prototypes and constructor declarations without a body, and namespace-scope
; declarations with an initializer.
(declaration declarator: (init_declarator) @name) @definition.variable
(declaration declarator: (_) @name) @definition.declaration

; Type aliases, typedefs and concepts.
(alias_declaration name: (type_identifier) @name) @definition.type
(type_definition declarator: (_) @name) @definition.typedef
(concept_definition name: (identifier) @name) @definition.concept

; Macros.
(preproc_def name: (identifier) @name) @definition.macro
(preproc_function_def name: (identifier) @name) @definition.macro

; Includes.
(preproc_include path: (_) @import)
