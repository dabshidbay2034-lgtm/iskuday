import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const ForgotPassword = () => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/signin");
  }, [navigate]);
  return null;
};
export default ForgotPassword;
