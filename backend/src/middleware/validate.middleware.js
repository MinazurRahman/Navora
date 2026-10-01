import { ValidationError } from '../shared/errors/AppError.js';

const REQUEST_PARTS = ['params', 'query', 'body'];

// validate({ params?, query?, body? }) — zod schemas per request part.
// Parsed (coerced, defaulted, unknown-keys-stripped) values land on req.validated;
// controllers read from there and never from the raw req.query/req.body.
export function validate(schemas) {
  return (req, res, next) => {
    const validated = {};
    const details = [];

    for (const part of REQUEST_PARTS) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ location: part, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (details.length > 0) return next(new ValidationError('Invalid request data', details));

    req.validated = { ...req.validated, ...validated };
    next();
  };
}
