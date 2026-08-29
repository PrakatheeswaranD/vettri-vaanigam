import { Navigate, Outlet } from "react-router-dom";
import { useAuthToken } from "../../hooks/use-auth";

/** Route guard (PART 10 §1). No session token → no route past this
 * point renders at all, client-side — the same boundary the backend
 * itself enforces via its global auth hook, so a stale or missing
 * session can never render a page that will just fail every request. */
export function RequireAuth() {
  const token = useAuthToken();
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}
