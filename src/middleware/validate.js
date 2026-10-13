const { validators, queryValidators } = require('../schemas');
const { AppError } = require('../errors');

const toDetails = (errs) => errs.map((e) => ({
  path: e.instancePath || (e.params && e.params.missingProperty ? `/${e.params.missingProperty}` : '/'),
  message: e.message,
  keyword: e.keyword,
}));

function validateBody(name) {
  const validate = validators[name];
  return (req, res, next) => {
    if (!validate(req.body)) {
      return next(new AppError(422, 'VALIDATION_ERROR', 'Request body failed JSON Schema validation', toDetails(validate.errors)));
    }
    next();
  };
}

// Validated + coerced query is placed on req.q (req.query stays untouched).
function validateQuery(name) {
  const validate = queryValidators[name];
  return (req, res, next) => {
    const q = { ...req.query };
    if (!validate(q)) {
      return next(new AppError(422, 'VALIDATION_ERROR', 'Query parameters failed JSON Schema validation', toDetails(validate.errors)));
    }
    req.q = q;
    next();
  };
}

module.exports = { validateBody, validateQuery };
