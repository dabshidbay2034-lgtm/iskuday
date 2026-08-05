import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const ResetPassword = () => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/signin");
  }, [navigate]);
  return null;
};
export default ResetPassword;
