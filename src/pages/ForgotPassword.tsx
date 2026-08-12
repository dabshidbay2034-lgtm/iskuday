import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const ForgotPassword = () => {
  const navigate = useNavigate();
  useEffect(() => {
    // `replace` so this stub never lands in history — Clerk owns password reset
    // inside the sign-in flow, and without it Back returns here and bounces
    // the user straight forward again.
    navigate("/signin", { replace: true });
  }, [navigate]);
  return null;
};
export default ForgotPassword;
