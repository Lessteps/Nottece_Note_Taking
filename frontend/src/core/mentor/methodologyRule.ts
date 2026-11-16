// Regla de metodología que todo prompt del Mentor que arma o juzga un plan debe llevar (un solo sitio para que un plan nuevo nunca vuelva a necesitar la corrección).

/**
 * Metodología de aprendizaje que TODA etapa de la generación del plan respeta (misma regla que el catálogo de referencia y las skills de la vault).
 * Está aquí, en un solo sitio, para que un plan nuevo la lleve siempre y no haya que corregirlo después.
 */
export const METHODOLOGY_RULE = [
  "METODOLOGÍA: antes de generar el plan, identifica objetivos, conocimientos previos, preguntas necesarias, áreas sustanciales y temas prioritarios. Escoge y justifica un método de estudio adecuado para cada materia.",
  "Organiza los temas por prerequisitos y explica por qué sigue cada uno. Propón teoría, práctica, evaluación y repaso adecuados al contenido, sin imponer la misma división a todas las materias.",
  "HTML y CSS pueden requerir referencias por elemento o propiedad cuando sea útil; no impongas esa regla a todos los lenguajes o materias. No inventes carpetas existentes.",
].join("\n");
