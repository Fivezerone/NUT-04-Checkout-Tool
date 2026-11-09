// Edge Functions use the canonical claims adapter shared with the UI and
// extension. This is a re-export, not a second raw-JWT parser.
export {
  extractClaims,
  requireRole,
  type CadClaims,
  type CadRole,
} from '../../../src/shared/rbac.ts'
