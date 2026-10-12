export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Expense Tracker and Budget Management API',
    version: '1.0.0',
    description: `REST API backend for the Expense Tracker and Budget Management System.

## Authentication
- **Access token**: JWT (HS256, 15 min) returned in the JSON body of register/login/refresh.
  Send it as \`Authorization: Bearer <accessToken>\`. Store in JS memory only.
- **Refresh token**: JWT (HS256, 7 days) delivered only as an \`httpOnly\` cookie
  (\`refreshToken\`, path \`/api/auth\`). Rotated on every refresh; reuse of a revoked
  token revokes the whole token family.
- The cookie-authenticated endpoints (\`POST /api/auth/refresh\`, \`POST /api/auth/logout\`)
  additionally require the header \`X-Requested-With: XMLHttpRequest\` (CSRF protection).

## Conventions
- All API routes live under \`/api\`; health checks are outside it.
- Dates are \`YYYY-MM-DD\`. Money is a JSON number with at most 2 decimals.
- Every response carries an \`X-Request-Id\` header.
- Every error uses the shape \`{"error":{"code","message","details"?}}\`.
- Records belonging to another user return \`404 NOT_FOUND\` (never 403).

## Rate limits
- Global: 100 requests/minute per IP.
- Login and register: 10 requests/15 minutes per IP.
- Refresh: 30 requests/15 minutes per IP.`,
  },
  servers: [{ url: 'http://localhost:5000', description: 'Local development' }],
  tags: [
    { name: 'Health', description: 'Liveness and readiness probes' },
    { name: 'auth', description: 'Registration, login, token rotation and session management' },
    { name: 'expenses', description: 'Expense CRUD with filtering, sorting and pagination' },
    { name: 'budgets', description: 'Monthly category budgets with spent/status computation' },
    { name: 'dashboard', description: 'Monthly summary overview' },
    { name: 'reports', description: 'JSON, CSV and Excel exports' },
    { name: 'meta', description: 'Static metadata' },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        operationId: 'getHealth',
        summary: 'Liveness probe',
        security: [],
        responses: {
          '200': {
            description: 'Service is alive',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        operationId: 'getReadiness',
        summary: 'Readiness probe (runs SELECT 1 against the database)',
        security: [],
        responses: {
          '200': {
            description: 'Database reachable',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } },
            },
          },
          '503': {
            description: 'Database unreachable',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['auth'],
        operationId: 'register',
        summary: 'Register a new user',
        description:
          'Creates the user and the first refresh token in one transaction, sets the refresh cookie and returns the access token. Rate limit: 10 per 15 minutes per IP.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
          },
        },
        responses: {
          '201': {
            description:
              'Account created; sets cookie Set-Cookie: refreshToken=...; HttpOnly; Path=/api/auth',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '409': {
            description: 'Email already registered',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  error: { code: 'EMAIL_TAKEN', message: 'Email already registered' },
                },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['auth'],
        operationId: 'login',
        summary: 'Log in',
        description:
          'On success resets failed-login counters, starts a new refresh-token family and sets the refresh cookie. Unknown email and wrong password return the same generic 401 INVALID_CREDENTIALS. 5 consecutive failures lock the account for 15 minutes (423 ACCOUNT_LOCKED). Rate limit: 10 per 15 minutes per IP.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Logged in; sets the refresh cookie',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': {
            description: 'Generic credential failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
                },
              },
            },
          },
          '423': {
            description: 'Account locked after too many failed logins',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  error: {
                    code: 'ACCOUNT_LOCKED',
                    message:
                      'Account locked due to too many failed login attempts. Try again in 15 minute(s).',
                  },
                },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['auth'],
        operationId: 'refreshToken',
        summary: 'Rotate the refresh token and get a new access token',
        description:
          'Reads the refreshToken cookie (no request body). The old token is revoked and a replacement is issued in one transaction. Presenting an already-revoked token revokes the entire token family and returns 401 TOKEN_REUSED. Requires the header X-Requested-With: XMLHttpRequest. Rate limit: 30 per 15 minutes per IP.',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/CsrfHeader' }],
        responses: {
          '200': {
            description: 'New access token; rotated refresh cookie',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AccessTokenResponse' } },
            },
          },
          '401': {
            description:
              'Missing, invalid, expired or reused refresh token. Codes: NO_REFRESH_TOKEN, TOKEN_EXPIRED, UNAUTHORIZED, TOKEN_REUSED. The refresh cookie is cleared.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                  missing: {
                    value: {
                      error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
                    },
                  },
                  reused: {
                    value: {
                      error: { code: 'TOKEN_REUSED', message: 'Refresh token reuse detected' },
                    },
                  },
                },
              },
            },
          },
          '403': { $ref: '#/components/responses/CsrfRejected' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['auth'],
        operationId: 'logout',
        summary: 'Log out (revoke the current refresh token)',
        description:
          'Revokes the token row for the presented cookie and clears the cookie. Succeeds (204) even when the cookie is missing or invalid. Requires the header X-Requested-With: XMLHttpRequest.',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/CsrfHeader' }],
        responses: {
          '204': { description: 'Logged out; cookie cleared' },
          '403': { $ref: '#/components/responses/CsrfRejected' },
        },
      },
    },
    '/api/auth/logout-all': {
      post: {
        tags: ['auth'],
        operationId: 'logoutAll',
        summary: 'Revoke every session for the current user',
        responses: {
          '204': { description: 'All refresh tokens revoked; cookie cleared' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['auth'],
        operationId: 'getCurrentUser',
        summary: 'Get the authenticated user',
        responses: {
          '200': {
            description: 'Current user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['user'],
                  properties: { user: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/expenses': {
      get: {
        tags: ['expenses'],
        operationId: 'listExpenses',
        summary: 'List expenses with filters, sorting and pagination',
        description:
          'totals.sumAmount is the sum over ALL rows matching the filters, not just the current page. Count, sum and page are read in one transaction.',
        parameters: [
          { $ref: '#/components/parameters/page' },
          { $ref: '#/components/parameters/limit' },
          { $ref: '#/components/parameters/startDate' },
          { $ref: '#/components/parameters/endDate' },
          { $ref: '#/components/parameters/category' },
          { $ref: '#/components/parameters/minAmount' },
          { $ref: '#/components/parameters/maxAmount' },
          { $ref: '#/components/parameters/search' },
          { $ref: '#/components/parameters/sortBy' },
          { $ref: '#/components/parameters/order' },
        ],
        responses: {
          '200': {
            description: 'Paginated expense list',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ExpenseListResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
      post: {
        tags: ['expenses'],
        operationId: 'createExpense',
        summary: 'Create an expense',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ExpenseCreate' } },
          },
        },
        responses: {
          '201': {
            description: 'Created expense',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Expense' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/expenses/{id}': {
      parameters: [{ $ref: '#/components/parameters/id' }],
      get: {
        tags: ['expenses'],
        operationId: 'getExpense',
        summary: 'Get one expense',
        description: 'Returns 404 when the expense does not exist or belongs to another user.',
        responses: {
          '200': {
            description: 'The expense',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Expense' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['expenses'],
        operationId: 'updateExpense',
        summary: 'Partially update an expense',
        description: 'At least one field must be provided. Returns 404 for foreign ids.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ExpenseUpdate' } },
          },
        },
        responses: {
          '200': {
            description: 'Updated expense',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Expense' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['expenses'],
        operationId: 'deleteExpense',
        summary: 'Delete an expense',
        responses: {
          '204': { description: 'Deleted' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/budgets': {
      get: {
        tags: ['budgets'],
        operationId: 'listBudgets',
        summary: 'List budgets for a month with computed spent/status',
        description:
          'month and year default to the current month. Each item includes spent (grouped sum of that category expenses in the month), remaining, percentUsed and status (ok < 80%, warning 80-100%, exceeded > 100%).',
        parameters: [
          { $ref: '#/components/parameters/month' },
          { $ref: '#/components/parameters/year' },
        ],
        responses: {
          '200': {
            description: 'Budgets for the requested month (bare array)',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Budget' } },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['budgets'],
        operationId: 'createBudget',
        summary: 'Create a monthly category budget',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/BudgetCreate' } },
          },
        },
        responses: {
          '201': {
            description: 'Created budget',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Budget' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '409': {
            description: 'A budget for this category and month already exists',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  error: {
                    code: 'BUDGET_EXISTS',
                    message: 'Budget already exists for this category and month',
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/budgets/copy': {
      post: {
        tags: ['budgets'],
        operationId: 'copyBudgets',
        summary: "Copy a month's budgets to another month",
        description:
          'Runs in one transaction. Categories that already exist in the target month are skipped.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/BudgetCopyRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Copy result',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BudgetCopyResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/budgets/{id}': {
      parameters: [{ $ref: '#/components/parameters/id' }],
      patch: {
        tags: ['budgets'],
        operationId: 'updateBudget',
        summary: "Update a budget's limit",
        description:
          'Only limit may change; category, month and year are immutable. Returns 404 for foreign ids.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/BudgetUpdate' } },
          },
        },
        responses: {
          '200': {
            description: 'Updated budget',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Budget' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['budgets'],
        operationId: 'deleteBudget',
        summary: 'Delete a budget',
        responses: {
          '204': { description: 'Deleted' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/dashboard/summary': {
      get: {
        tags: ['dashboard'],
        operationId: 'getDashboardSummary',
        summary: 'Monthly dashboard summary',
        description:
          'month/year default to the current month. remainingBudget subtracts the spend in budgeted categories only and may be negative (overBudget: true). recentExpenses holds the latest 5 expenses of the period; monthlyTrend covers the last 6 months including the selected month.',
        parameters: [
          { $ref: '#/components/parameters/month' },
          { $ref: '#/components/parameters/year' },
        ],
        responses: {
          '200': {
            description: 'Dashboard summary',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DashboardSummary' } },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/reports/monthly': {
      get: {
        tags: ['reports'],
        operationId: 'monthlyReport',
        summary: 'Monthly report as JSON, CSV or Excel',
        description:
          'CSV/XLSX are returned as attachments (expenses-YYYY-MM.ext) with a UTF-8 BOM on CSV. Text cells starting with =, +, -, @, tab or CR are prefixed with a single quote (injection protection). Reports are capped at 50,000 rows.',
        parameters: [
          { $ref: '#/components/parameters/month' },
          { $ref: '#/components/parameters/year' },
          { $ref: '#/components/parameters/format' },
        ],
        responses: {
          '200': {
            description:
              'JSON report (default) or file download when format=csv / format=xlsx.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MonthlyReport' } },
              'text/csv': {
                schema: { type: 'string' },
              },
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '400': {
            description: 'Validation failure or report exceeds 50,000 rows',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/reports/yearly': {
      get: {
        tags: ['reports'],
        operationId: 'yearlyReport',
        summary: 'Yearly report as JSON, CSV or Excel',
        description:
          'Per-month totals, per-category totals and grand total. CSV/XLSX are attachments (expenses-YYYY.ext) with the same injection protection as the monthly report.',
        parameters: [
          { $ref: '#/components/parameters/year' },
          { $ref: '#/components/parameters/format' },
        ],
        responses: {
          '200': {
            description:
              'JSON report (default) or file download when format=csv / format=xlsx.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/YearlyReport' } },
              'text/csv': {
                schema: { type: 'string' },
              },
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '400': {
            description: 'Validation failure or report exceeds 50,000 rows',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/meta/categories': {
      get: {
        tags: ['meta'],
        operationId: 'getCategories',
        summary: 'Get the fixed category list',
        responses: {
          '200': {
            description: 'Category names',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CategoryList' } },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from register/login/refresh.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
        description: 'httpOnly refresh cookie, path-scoped to /api/auth.',
      },
    },
    parameters: {
      id: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'Resource id; malformed UUIDs return 400.',
      },
      page: {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
      limit: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      startDate: {
        name: 'startDate',
        in: 'query',
        schema: { type: 'string', format: 'date' },
        description: 'Inclusive lower bound; must be on or before endDate.',
      },
      endDate: {
        name: 'endDate',
        in: 'query',
        schema: { type: 'string', format: 'date' },
        description: 'Inclusive upper bound.',
      },
      category: {
        name: 'category',
        in: 'query',
        schema: { type: 'string' },
        description: 'One or more categories, comma separated (e.g. Food,Transport).',
        example: 'Food,Transport',
      },
      minAmount: {
        name: 'minAmount',
        in: 'query',
        schema: { type: 'number', minimum: 0 },
        description: 'Inclusive lower bound; must be <= maxAmount.',
      },
      maxAmount: {
        name: 'maxAmount',
        in: 'query',
        schema: { type: 'number', minimum: 0 },
      },
      search: {
        name: 'search',
        in: 'query',
        schema: { type: 'string', maxLength: 100 },
        description: 'Case-insensitive match on title.',
      },
      sortBy: {
        name: 'sortBy',
        in: 'query',
        schema: { type: 'string', enum: ['date', 'amount', 'createdAt'], default: 'date' },
      },
      order: {
        name: 'order',
        in: 'query',
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      },
      month: {
        name: 'month',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 12 },
        description: 'Defaults to the current month.',
      },
      year: {
        name: 'year',
        in: 'query',
        schema: { type: 'integer', minimum: 2000, maximum: 2100 },
        description: 'Defaults to the current year.',
      },
      format: {
        name: 'format',
        in: 'query',
        schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
      },
      CsrfHeader: {
        name: 'X-Requested-With',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['XMLHttpRequest'] },
        description: 'Custom header required on cookie-authenticated endpoints (CSRF defense).',
      },
    },
    responses: {
      BadRequest: {
        description: 'Validation failure (Zod), malformed JSON, bad id or bad query combination',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: [{ field: 'amount', message: 'Must be greater than 0' }],
              },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Missing, malformed, invalid or expired access token',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            examples: {
              missing: {
                value: { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
              },
              expired: {
                value: { error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' } },
              },
            },
          },
        },
      },
      CsrfRejected: {
        description: 'Missing or invalid X-Requested-With header on a cookie-authenticated endpoint',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: { code: 'CSRF_REJECTED', message: 'Missing required CSRF header' },
            },
          },
        },
      },
      NotFound: {
        description: 'Resource missing or owned by another user',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: { code: 'NOT_FOUND', message: 'Resource not found' } },
          },
        },
      },
      RateLimited: {
        description: 'Rate limit exceeded (global or route-specific)',
        headers: {
          'Retry-After': {
            schema: { type: 'integer' },
            description: 'Seconds until the limit resets',
          },
        },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please try again later',
              },
            },
          },
        },
      },
    },
    schemas: {
      HealthStatus: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['ok'] } },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHORIZED',
                  'TOKEN_EXPIRED',
                  'INVALID_CREDENTIALS',
                  'NO_REFRESH_TOKEN',
                  'TOKEN_REUSED',
                  'CSRF_REJECTED',
                  'NOT_FOUND',
                  'EMAIL_TAKEN',
                  'BUDGET_EXISTS',
                  'ACCOUNT_LOCKED',
                  'RATE_LIMITED',
                  'INTERNAL_ERROR',
                  'NOT_READY',
                  'CONFLICT',
                ],
              },
              message: { type: 'string' },
              details: {
                type: 'array',
                items: { $ref: '#/components/schemas/ErrorDetail' },
              },
            },
          },
        },
      },
      ErrorDetail: {
        type: 'object',
        required: ['field', 'message'],
        properties: {
          field: { type: 'string' },
          message: { type: 'string' },
        },
      },
      Category: {
        type: 'string',
        enum: [
          'Food',
          'Transport',
          'Rent',
          'Utilities',
          'Health',
          'Entertainment',
          'Shopping',
          'Education',
          'Travel',
          'Other',
        ],
      },
      CategoryList: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
      User: {
        type: 'object',
        required: ['id', 'name', 'email', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', maxLength: 100 },
          email: { type: 'string', format: 'email', maxLength: 255 },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      RegisterRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 100 },
          email: { type: 'string', format: 'email', maxLength: 255 },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 72,
            description: 'At least one letter and one digit; must not equal the name or the email.',
          },
        },
      },
      LoginRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1, maxLength: 72 },
        },
      },
      AuthResponse: {
        type: 'object',
        required: ['user', 'accessToken'],
        properties: {
          user: { $ref: '#/components/schemas/User' },
          accessToken: { type: 'string', description: 'JWT access token, valid 15 minutes.' },
        },
      },
      AccessTokenResponse: {
        type: 'object',
        required: ['accessToken'],
        properties: { accessToken: { type: 'string' } },
      },
      Amount: {
        type: 'number',
        minimum: 0,
        exclusiveMinimum: true,
        maximum: 9999999999.99,
        description: 'Positive money amount with at most 2 decimal places.',
      },
      DateOnly: {
        type: 'string',
        format: 'date',
        description: 'Calendar date YYYY-MM-DD, at most 1 year in the future.',
      },
      Expense: {
        type: 'object',
        required: ['id', 'title', 'amount', 'category', 'date', 'description', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string', maxLength: 120 },
          amount: { $ref: '#/components/schemas/Amount' },
          category: { $ref: '#/components/schemas/Category' },
          date: { $ref: '#/components/schemas/DateOnly' },
          description: { type: 'string', nullable: true, maxLength: 500 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ExpenseCreate: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'amount', 'category', 'date'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          amount: { $ref: '#/components/schemas/Amount' },
          category: { $ref: '#/components/schemas/Category' },
          date: { $ref: '#/components/schemas/DateOnly' },
          description: { type: 'string', maxLength: 500, nullable: true },
        },
      },
      ExpenseUpdate: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          amount: { $ref: '#/components/schemas/Amount' },
          category: { $ref: '#/components/schemas/Category' },
          date: { $ref: '#/components/schemas/DateOnly' },
          description: { type: 'string', maxLength: 500, nullable: true },
        },
      },
      ExpenseListResponse: {
        type: 'object',
        required: ['data', 'meta', 'totals'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Expense' } },
          meta: {
            type: 'object',
            required: ['page', 'limit', 'total', 'totalPages'],
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
          totals: {
            type: 'object',
            required: ['sumAmount'],
            properties: {
              sumAmount: {
                type: 'number',
                description: 'Sum of amount over ALL rows matching the filters.',
              },
            },
          },
        },
      },
      BudgetStatus: {
        type: 'string',
        enum: ['ok', 'warning', 'exceeded'],
        description: 'ok < 80%, warning 80-100%, exceeded > 100% of the limit.',
      },
      Budget: {
        type: 'object',
        required: ['id', 'category', 'limit', 'month', 'year', 'spent', 'remaining', 'percentUsed', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          category: { $ref: '#/components/schemas/Category' },
          limit: { type: 'number' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          year: { type: 'integer', minimum: 2000, maximum: 2100 },
          spent: { type: 'number', description: "Sum of this category's expenses in the month." },
          remaining: { type: 'number' },
          percentUsed: { type: 'number', description: 'Rounded to 1 decimal.' },
          status: { $ref: '#/components/schemas/BudgetStatus' },
        },
      },
      BudgetCreate: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'limit', 'month', 'year'],
        properties: {
          category: { $ref: '#/components/schemas/Category' },
          limit: { $ref: '#/components/schemas/Amount' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          year: { type: 'integer', minimum: 2000, maximum: 2100 },
        },
      },
      BudgetUpdate: {
        type: 'object',
        additionalProperties: false,
        required: ['limit'],
        properties: { limit: { $ref: '#/components/schemas/Amount' } },
      },
      BudgetCopyRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['fromMonth', 'fromYear', 'toMonth', 'toYear'],
        properties: {
          fromMonth: { type: 'integer', minimum: 1, maximum: 12 },
          fromYear: { type: 'integer', minimum: 2000, maximum: 2100 },
          toMonth: { type: 'integer', minimum: 1, maximum: 12 },
          toYear: { type: 'integer', minimum: 2000, maximum: 2100 },
        },
      },
      BudgetCopyResponse: {
        type: 'object',
        required: ['copied', 'skipped'],
        properties: {
          copied: { type: 'integer', description: 'Budgets created in the target month.' },
          skipped: {
            type: 'integer',
            description: 'Source categories already present in the target month.',
          },
        },
      },
      DashboardCategoryRow: {
        type: 'object',
        required: ['category', 'spent', 'budget', 'remaining', 'percentUsed', 'status'],
        properties: {
          category: { $ref: '#/components/schemas/Category' },
          spent: { type: 'number' },
          budget: {
            type: 'number',
            nullable: true,
            description: 'Null when the category has spend but no budget.',
          },
          remaining: { type: 'number', nullable: true },
          percentUsed: { type: 'number', nullable: true },
          status: { $ref: '#/components/schemas/StatusOrNull' },
        },
      },
      StatusOrNull: {
        allOf: [{ $ref: '#/components/schemas/BudgetStatus' }],
        nullable: true,
      },
      RecentExpense: {
        type: 'object',
        required: ['id', 'title', 'amount', 'category', 'date', 'description', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          amount: { type: 'number' },
          category: { $ref: '#/components/schemas/Category' },
          date: { $ref: '#/components/schemas/DateOnly' },
          description: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      TrendPoint: {
        type: 'object',
        required: ['month', 'year', 'total'],
        properties: {
          month: { type: 'integer', minimum: 1, maximum: 12 },
          year: { type: 'integer' },
          total: { type: 'number' },
        },
      },
      DashboardSummary: {
        type: 'object',
        required: [
          'period',
          'totalSpent',
          'totalBudget',
          'remainingBudget',
          'overBudget',
          'categories',
          'recentExpenses',
          'monthlyTrend',
        ],
        properties: {
          period: {
            type: 'object',
            required: ['month', 'year'],
            properties: {
              month: { type: 'integer' },
              year: { type: 'integer' },
            },
          },
          totalSpent: { type: 'number', description: 'Sum of all expenses in the selected month.' },
          totalBudget: { type: 'number', description: 'Sum of budget limits for the month.' },
          remainingBudget: {
            type: 'number',
            description: 'totalBudget minus spend in budgeted categories only; may be negative.',
          },
          overBudget: { type: 'boolean' },
          categories: {
            type: 'array',
            items: { $ref: '#/components/schemas/DashboardCategoryRow' },
          },
          recentExpenses: {
            type: 'array',
            maxItems: 5,
            items: { $ref: '#/components/schemas/RecentExpense' },
          },
          monthlyTrend: {
            type: 'array',
            maxItems: 6,
            items: { $ref: '#/components/schemas/TrendPoint' },
          },
        },
      },
      ReportExpenseRow: {
        type: 'object',
        required: ['id', 'date', 'title', 'category', 'amount', 'description', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          date: { $ref: '#/components/schemas/DateOnly' },
          title: { type: 'string' },
          category: { $ref: '#/components/schemas/Category' },
          amount: { type: 'number' },
          description: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      MonthlyReportCategoryTotal: {
        type: 'object',
        required: ['category', 'spent', 'budget', 'remaining'],
        properties: {
          category: { $ref: '#/components/schemas/Category' },
          spent: { type: 'number' },
          budget: { type: 'number', nullable: true },
          remaining: { type: 'number', nullable: true },
        },
      },
      MonthlyReport: {
        type: 'object',
        required: ['period', 'expenses', 'categoryTotals', 'total'],
        properties: {
          period: {
            type: 'object',
            required: ['month', 'year'],
            properties: {
              month: { type: 'integer' },
              year: { type: 'integer' },
            },
          },
          expenses: { type: 'array', items: { $ref: '#/components/schemas/ReportExpenseRow' } },
          categoryTotals: {
            type: 'array',
            items: { $ref: '#/components/schemas/MonthlyReportCategoryTotal' },
          },
          total: { type: 'number' },
        },
      },
      YearlyReport: {
        type: 'object',
        required: ['period', 'monthlyTotals', 'categoryTotals', 'grandTotal'],
        properties: {
          period: {
            type: 'object',
            required: ['year'],
            properties: { year: { type: 'integer' } },
          },
          monthlyTotals: {
            type: 'array',
            items: {
              type: 'object',
              required: ['month', 'total', 'budget'],
              properties: {
                month: { type: 'integer' },
                total: { type: 'number' },
                budget: { type: 'number' },
              },
            },
          },
          categoryTotals: {
            type: 'array',
            items: {
              type: 'object',
              required: ['category', 'total'],
              properties: {
                category: { $ref: '#/components/schemas/Category' },
                total: { type: 'number' },
              },
            },
          },
          grandTotal: { type: 'number' },
        },
      },
    },
  },
};
