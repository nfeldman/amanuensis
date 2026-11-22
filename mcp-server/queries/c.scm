; Definition queries for C (PLAN §4.2). The code index reads its definitions from these
; patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole declaration, @name its declarator (the extractor
; reads the name inside pointer, array and function declarators), and @import an include's
; path. A declaration is a definition only at file scope and with an initializer; the
; extractor drops the rest, so prototypes and `extern` declarations are not definitions.

; Function definitions with their bodies.
(function_definition declarator: (_) @name) @definition.function

; Struct, union and enum specifiers with a body.
(struct_specifier name: (type_identifier) @name body: (_)) @definition.struct
(union_specifier name: (type_identifier) @name body: (_)) @definition.union
(enum_specifier name: (type_identifier) @name body: (_)) @definition.enum

; Typedefs, one definition per declarator.
(type_definition declarator: (_) @name) @definition.typedef

; File-scope declarations with an initializer.
(declaration declarator: (init_declarator) @name) @definition.variable

; Macros.
(preproc_def name: (identifier) @name) @definition.macro
(preproc_function_def name: (identifier) @name) @definition.macro

; Includes.
(preproc_include path: (_) @import)
