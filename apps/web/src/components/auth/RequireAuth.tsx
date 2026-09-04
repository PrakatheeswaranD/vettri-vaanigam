import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthToken, useCurrentUser } from "../../hooks/use-auth";
import { ApiError } from "../../lib/api-client";
import { clearToken } from "../../lib/auth-storage";
import { ErrorState } from "../ui/States";
import { ROLE_HOME, setExperienceRole, type ExperienceRole } from "../../lib/experience-role";

/** Route guard (PART 10 §1). No session token → no route past this
 * point renders at all, client-side — the same boundary the backend
 * itself enforces via its global auth hook, so a stale or missing
 * session can never render a page that will just fail every request. */
export function RequireAuth() {
  const token = useAuthToken();
  const user = useCurrentUser();
  const location = useLocation();
  const role: ExperienceRole =
    user.data?.role === "CUSTOMER" ? "customer" : user.data?.role === "PLATFORM_ADMIN" ? "admin" : "merchant";
  useEffect(() => { if (user.data) setExperienceRole(role); }, [user.data, role]);
  if (!token) return <Navigate to="/login" replace />;
  if (user.isPending) return <p role="status" className="p-6">Verifying account access…</p>;

  if (user.isError) {
    /**
     * "YOUR SESSION IS INVALID" AND "THE SERVER IS BROKEN" ARE NOT THE
     * SAME EVENT, AND THIS USED TO TREAT THEM AS ONE.
     *
     * Every error redirected to /login. For a 401 that is right: the API
     * client has already cleared the token, so the login screen renders
     * its form and the person signs in again.
     *
     * For anything else the token is still there — and the login screen
     * sends a request with a live token straight back to where it came
     * from. Guard → login → guard → login, which React Router resolves by
     * rendering NOTHING. A database blip or a deploy restart left the
     * user staring at a permanently blank white page: no message, no
     * retry, no way out but clearing site data, which is not something a
     * user can be asked to do.
     *
     * So: an authentication failure goes to login, and a server failure
     * says the server failed and offers to try again.
     */
    const status = user.error instanceof ApiError ? user.error.status : null;
    const sessionRejected = status === 401 || status === 403;
    if (sessionRejected) {
      // Belt and braces: the API client clears the token on a 401, and if
      // that ever stops being true this redirect must still not become a
      // loop.
      clearToken();
      return <Navigate to="/login" replace />;
    }

    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          message={
            status === null
              ? "We couldn't reach the server. Check your connection and try again — you are still signed in."
              : `The server couldn't confirm your account (error ${status}). This is not a problem with your sign-in, and retrying often works.`
          }
          onRetry={() => void user.refetch()}
        />
      </div>
    );
  }

  const requestedRole = location.pathname.split("/")[1];
  if (["customer", "merchant", "admin"].includes(requestedRole ?? "") && requestedRole !== role) return <Navigate to={ROLE_HOME[role]} replace />;
  if (role !== "merchant" && requestedRole !== role) return <Navigate to={ROLE_HOME[role]} replace />;
  return <Outlet />;
}
