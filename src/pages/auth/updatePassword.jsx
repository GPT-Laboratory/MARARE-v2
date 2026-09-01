/**
 * Password reset form after Supabase email link.
 * File: src/pages/auth/updatePassword.jsx
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from '../../services/supabase/supabaseclient';
import '../../pages/auth/Auth.css'; // Assuming you have a CSS file for styling
import { useSnackbar } from 'notistack';

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const {enqueueSnackbar} = useSnackbar()
  const giveSuccessNotification =  (message)=>{
      enqueueSnackbar(message, {
        variant: 'success',
        anchorOrigin: { vertical: 'top', horizontal: 'left' },
        autoHideDuration: 2000,
      })
  }
  

  const handleUpdate = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      setError(error.message);
    } else {
      giveSuccessNotification("Password updated! You can now log in.");
      setTimeout(() => {
         navigate("/login");
      }, 2000);
     
    }
  };

  return (
    <>
      <div className="auth-container">
        <div className="auth-box">
          <h2 className="auth-title">Update Password</h2>
          <form className="update-password-form" onSubmit={handleUpdate}>
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button
              type="submit"
              className="submit-button"
              style={{ marginTop: "10px" }}
            >
              Update Password
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
