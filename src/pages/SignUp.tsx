import { SignUp as ClerkSignUp } from "@clerk/clerk-react";

const SignUp = () => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <ClerkSignUp routing="path" path="/signup" signInUrl="/signin" fallbackRedirectUrl="/complete-profile" />
    </div>
  );
};

export default SignUp;
