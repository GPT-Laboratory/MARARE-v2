/**
 * Login and registration — email/password and Google OAuth.
 * File: src/pages/auth/Auth.jsx
 */
import { useState, useRef, useEffect } from "react";
import { Button, Input, Form, Typography, Divider, Space } from "antd";
import { GoogleOutlined, CloseOutlined, LeftOutlined } from "@ant-design/icons";
import supabase from '../../services/supabase/supabaseclient';
import PropTypes from "prop-types";
import { ThreeCircles } from "react-loader-spinner";
import { useLocation, useNavigate } from "react-router-dom";
import { useSnackbar } from 'notistack';

const { Title, Text } = Typography;

export default function Auth(props) {
  // all variables and hooks
  const navigate = useNavigate();
  const location = useLocation();
  console.log("location 2", location);
  const { from } = location.state || { from: { pathname: "/" } };
  console.log("meeting id", from);
  const { enqueueSnackbar } = useSnackbar();
  const giveSuccessNotification = (message) => {
    enqueueSnackbar(message, {
      variant: 'success',
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
    })
  }
  const giveWarnNotification = (message) => {
    enqueueSnackbar(message, {
      variant: "warning",
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
    })
  }

  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState(null);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => {
    localStorage.setItem("redirectAfterLogin", from.pathname);
  }, [from]);

  // useEffect(() => {
  //   const { data: listener } = supabase.auth.onAuthStateChange(
  //     (event, session) => {
  //       console.log("EVENT:", event);
  
  //       if (event === "SIGNED_IN" && session) {
  //         console.log("SESSION:", session);
  //         localStorage.setItem("showTermsPopup", "true");
          
  //         if (props.setIsLoggedIn) {
  //           props.setIsLoggedIn(true);
  //         }
  
  //         const redirectAfterLogin =
  //           localStorage.getItem("redirectAfterLogin") || "/";
  
  //         localStorage.removeItem("redirectAfterLogin");
  
  //         navigate(redirectAfterLogin);
  //       }
  //     }
  //   );
  
  //   return () => {
  //     listener.subscription.unsubscribe();
  //   };
  // }, []);



  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log("EVENT:", event);
  
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
          console.log("SESSION:", session);
          localStorage.setItem("showTermsPopup", "true"); // ✅ will now catch OAuth redirect
          
          if (props.setIsLoggedIn) {
            props.setIsLoggedIn(true);
          }
  
          const redirectAfterLogin =
            localStorage.getItem("redirectAfterLogin") || "/";
          localStorage.removeItem("redirectAfterLogin");
          navigate(redirectAfterLogin);
        }
      }
    );
  
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const spinner = (
    <ThreeCircles
      visible={true}
      height="20"
      width="20"
      color="white"
      ariaLabel="three-circles-loading"
      wrapperStyle={{}}
      wrapperClass=""
    />
  );

  // to close authenticate component
  // const clsfunc = () => {
  //   props.handle(false);
  // };

  // button reference
  // const buttonref = useRef();

  // hiding cls button

  // const hide = props.hideBtn;
  // useEffect(() => {
  //   if (hide) {
  //     buttonref.current.style.display = "none";
  //   }
  // }, [hide]);

  const backHandler = () => {
    console.log("Back button clicked");

    navigate(from.pathname)
  }


  const signupProp = props.isSignup;
  console.log("Signup Prop", signupProp);

  useEffect(() => {
    if (signupProp) {
      setIsSignUp(true);
    }
  }, [signupProp]);



  const handleAuth = async (values) => {
    setLoading(true);
    setError(null);

    try {
      let authError = null;

      // if (isSignUp) {
      //   const { error } = await supabase.auth.signUp({
      //     email: values.email,
      //     password: values.password,
      //   });
      //   authError = error;
      // }
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            data: { full_name: values.full_name },
          },
        });

        authError = error;

        if (!authError && data?.user && !data.session) {
          setPendingConfirmationEmail(values.email);
          giveSuccessNotification("Check your email to confirm your account.");
          return;
        }
      }
      else {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });
        authError = error;
      }

      if (authError) throw authError;

      // ✅ Add this line here
      localStorage.setItem("showTermsPopup", "true");
      console.log("SET showTermsPopup:", localStorage.getItem("showTermsPopup"));

      // Update login state in App
      if (props.setIsLoggedIn) {
        props.setIsLoggedIn(true);
      }

      // Redirect after login/signup
      const redirectAfterLogin =
        localStorage.getItem("redirectAfterLogin") || "/";
      localStorage.removeItem("redirectAfterLogin");
      navigate(redirectAfterLogin);
    } catch (error) {
      setError(error.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider) => {
    try {
      localStorage.setItem("redirectAfterLogin", from.pathname);
      localStorage.setItem("showTermsPopup", "true"); 

      // const redirectAfterLogin =
      //   localStorage.getItem("redirectAfterLogin") ?? null;

      const redirectAfterLogin =
         localStorage.getItem("redirectAfterLogin") ?? null;

      console.log("Redirecting to:", redirectAfterLogin);
      console.log(redirectAfterLogin);

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}${redirectAfterLogin}`,
        },
      });

      if (error) throw error;
    } catch (error) {
      setError(error.message || "An error occurred during OAuth login");
    }
  };

  const handleForgetPassword = async () => {
    console.log("Forget password clicked");
    setLoading(true);
    setError(null);

    const emailValue = form.getFieldValue("email");
    if (!emailValue) {
      giveWarnNotification("Please enter your email to reset password.");
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailValue, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      setLoading(false);
      giveSuccessNotification("Check your email for password reset link.");
      if (error) throw error;
    } catch (error) {
      setError(error.message || "An error occurred");
    }
  };



  return (
    <>
      <div className="fixed inset-0 bg-white bg-opacity-50 flex items-center justify-center z-30 pt-20">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8 relative">
          {/* Close button */}
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={backHandler}
            className="absolute top-4 right-4 text-gray-500"
          />

          {/* Title */}
          <div className="text-center mb-8">
            <Title
              level={2}
              className="!mb-0 !text-2xl !font-bold !text-gray-900"
            >
              {pendingConfirmationEmail
                ? "Confirm your email"
                : isSignUp
                  ? "Create Your Account"
                  : "Sign in to your account"}
            </Title>
          </div>

          {pendingConfirmationEmail ? (
            <div className="space-y-6 text-center">
              <Text className="!text-gray-600 !text-base block">
                We sent a confirmation link to{" "}
                <span className="font-semibold text-gray-900">
                  {pendingConfirmationEmail}
                </span>
                . Open your inbox and click the link to activate your account,
                then sign in below.
              </Text>
              <Text type="secondary" className="!text-sm block">
                Did not receive it? Check spam or try signing up again with the
                same email.
              </Text>
              <Button
                type="primary"
                size="large"
                className="!w-full !h-12 !rounded-lg !bg-blue-600 !border-blue-600 hover:!bg-blue-700 !text-base !font-medium"
                onClick={() => {
                  setPendingConfirmationEmail(null);
                  setIsSignUp(false);
                  setError(null);
                  form.resetFields();
                }}
              >
                Back to Sign in
              </Button>
            </div>
          ) : (
          <>
          {/* Form */}
          <Form
            form={form}
            onFinish={handleAuth}
            layout="vertical"
            className="space-y-6"
          >
            <Form.Item
              name="email"
              label={
                <span className="text-base font-medium text-gray-900">
                  Email
                </span>
              }
              rules={[
                { required: true, message: "Please input your email!" },
                { type: "email", message: "Please enter a valid email!" },
              ]}
            >
              <Input
                size="large"
                className="!h-12 !rounded-lg !border-gray-300"
                placeholder=""
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={
                <span className="text-base font-medium text-gray-900">
                  Password
                </span>
              }
              rules={[
                { required: true, message: "Please input your password!" },
              ]}
            >
              <Input.Password
                size="large"
                className="!h-12 !rounded-lg !border-gray-300"
                placeholder=""
              />
            </Form.Item>

            {isSignUp && (
              <Form.Item
              
                name="full_name"
                label={
                  <span className="text-base font-medium text-gray-900 ">Enter Name</span>
                }
                rules={[{ required: true, message: "Please enter your full name!" }]}
              >
                <Input
                  size="large"
                  className="!h-12 !rounded-lg !border-gray-300 mb-10"
                  placeholder="Enter your name"
                />
              </Form.Item>
            )}


            {/* Error message */}
            {error && (
              <div className="text-red-500 text-sm text-center ">
                {error}
              </div>
            )}

            {/* Sign up button */}
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                className="!w-full !h-12 !rounded-lg mt-2 !bg-blue-600 !border-blue-600 hover:!bg-blue-700 !text-base !font-medium"
              >
                {loading ? spinner : isSignUp ? "Sign up" : "Sign in"}
              </Button>
            </Form.Item>
          </Form>

          {/* Forget Password */}
          <div className="text-center mb-6">
            <Button
              type="link"
              onClick={handleForgetPassword}
              className="!text-blue-600 !p-0 !h-auto !text-base hover:!text-blue-700"
            >
              Forget Password?
            </Button>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">
                or continue with
              </span>
            </div>
          </div>

          {/* Google OAuth Button */}
          <Button
            onClick={() => handleOAuth("google")}
            size="large"
            className="!w-full !h-12 !rounded-lg !border-gray-300 hover:!border-gray-400 !text-base !font-medium !text-gray-700 !bg-white hover:!bg-gray-50 !flex !items-center !justify-center !gap-3"
          >
            <GoogleOutlined className="!text-lg" />
            Continue with google
          </Button>

          {/* Toggle Sign in/Sign up */}
          <div className="text-center mt-6">
            <Button
              type="link"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setPendingConfirmationEmail(null);
                setError(null);
              }}
              className="!text-blue-600 !p-0 !h-auto !text-base hover:!text-blue-700"
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Don't have an account? Sign up"}
            </Button>
          </div>
          </>
          )}
        </div>
      </div>
    </>
  );
}

Auth.propTypes = {
  handle: PropTypes.func,
  hideBtn: PropTypes.node,
  setIsLoggedIn: PropTypes.func,
  isSignup: PropTypes.node.isRequired,
};
