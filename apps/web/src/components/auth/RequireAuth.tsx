import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthToken, useCurrentUser } from "../../hooks/use-auth";
import { ROLE_HOME, setExperienceRole } from "../../lib/experience-role";

/** Route guard (PART 10 §1). No session token → no route past this
 * point renders at all, client-side — the same boundary the backend
 * itself enforces via its global auth hook, so a stale or missing
 * session can never render a page that will just fail every request. */
export function RequireAuth() {
  const token = useAuthToken();
  const user = useCurrentUser();
  const location = useLocation();
  const role = user.data?.role === "CUSTOMER" ? "customer" : "merchant";
  useEffect(() => { if (user.data) setExperienceRole(role); }, [user.data, role]);
  if (!token) return <Navigate to="/login" replace />;
  if (user.isPending) return <p role="status" className="p-6">Verifying account access…</p>;
  if (user.isError) return <Navigate to="/login" replace />;
  const requestedRole = location.pathname.split("/")[1];
  if (["customer", "merchant"].includes(requestedRole ?? "") && requestedRole !== role) return <Navigate to={ROLE_HOME[role]} replace />;
  if (role !== "merchant" && requestedRole !== role) return <Navigate to={ROLE_HOME[role]} replace />;
  return <Outlet />;
}
