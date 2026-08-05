import { SignIn as ClerkSignIn } from "@clerk/clerk-react";

const SignIn = () => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <ClerkSignIn routing="path" path="/signin" signUpUrl="/signup" />
    </div>
  );
};

export default SignIn;
