/**
 * Generic page layout wrapper.
 * File: src/components/layout/Layout.jsx
 */
// import { Outlet, useNavigate } from "react-router-dom";
// import { Footer, Header } from "antd/es/layout/layout";
// import { RQicon } from "../mysvg";
// // for authentication
// import { useState, useRef, useEffect } from "react";
// import { useAuth } from "./authUserContext.jsx";
// import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
// import { faUser, faSignOut } from "@fortawesome/free-solid-svg-icons";
// import supabase from '../../services/supabase/supabaseclient.jsx';
// import { useLocation } from "react-router-dom";
// import './Layout.css'

// const Layout = () => {
// 	// all variables and hook for authentication
// 	const userElement = <FontAwesomeIcon icon={faUser} />;
// 	const Signout = <FontAwesomeIcon icon={faSignOut} />;
// 	const [showSignUp, setShowSignUp] = useState(false);
// 	const { user } = useAuth();
// 	const [showDropdown, setShowDropDown] = useState(false);
// 	const profileBtnRef = useRef();
// 	const dropdownRef = useRef();
// 	const imgElement = user?.user_metadata.picture ?? null;
// 	const location = useLocation();
// 	const pathName = location.pathname;
// 	const navigate = useNavigate();
    


// 	// handling logging out the user
// 	const handleLogout = async () => {
// 		try {
// 			const { error } = await supabase.auth.signOut();
// 			if (error) throw error;
// 			localStorage.clear();
// 			window.location.href = "/";
// 		} catch (error) {
// 			console.log("Error occured while signout: ", error);
// 			alert("Error while Signout. Try Again!");
// 		}
// 	};
    
	
// 	// for toggling effect of dropdown
// 	useEffect(() => {
// 		const handleWindowClick = (event) => {
// 			if (
// 				(dropdownRef.current &&
// 					!dropdownRef.current.contains(event.target)) && // Click is outside dropdown
// 				(profileBtnRef.current &&
// 					!profileBtnRef.current.contains(event.target)) // Click is outside profile button
// 			) {
// 				setShowDropDown(false); // Close dropdown
// 			}
// 		};

// 		if (showDropdown) {
// 			window.addEventListener("click", handleWindowClick);
// 		}

// 		return () => {
// 			window.removeEventListener("click", handleWindowClick);
// 		};
// 	}, [showDropdown]);

// 	// taking buttom ref
// 	const authBtnRef = useRef(null);
	
// 	useEffect(() => {
// 		if (authBtnRef.current) {
// 			if (user) {
// 				authBtnRef.current.classList.remove("before-btn");
// 				authBtnRef.current.classList.add("btn");
// 			}
// 			else {
// 				authBtnRef.current.classList.remove("btn");
// 				authBtnRef.current.classList.add("before-btn");
// 			}
// 		}
// 	}, [user])

    
// 	return (
// 		<div>
// 			<Header style={{ backgroundColor: "#f3fff3",  overflow:'hidden' }}>
// 				<div
// 					style={{
// 						display: "flex",
// 						flexDirection: "row",
// 						justifyContent: "space-between",
// 						marginLeft: "0px",
// 						// border:'1px solid red',
// 						// width: "100%",
// 					}}>
// 					<div 
// 					 style={{
// 						// border:'1px solid blue',
// 					 }}
// 					>
// 						<RQicon
// 							width={"60px"}
// 							height={"60px"}
// 						/>
// 					</div>
// 					<div style={{ fontSize: "20px", color: "black", marginLeft:'350px', }}>
// 						<strong>Multi-Agent Requirement Tool</strong>
// 					</div>
// 					{/* toogle the button and component by conditional rendering */}
// 					<div className="element"  style={{
// 						// border:'1px solid blue',
// 					 }}>

// 						{!showSignUp && !user && (
// 							<button
// 								ref={authBtnRef}
// 								className="btn before-btn"
// 								onClick={() => {
// 									navigate("/login");
// 								}}
// 							>
// 								Sign Up/Log in
// 							</button>
// 						)}
// 						{!showSignUp && user && (
// 							<div>
// 								<button
// 									className="btn btnflex"
// 									ref={profileBtnRef}
// 									onClick={() => {
// 										setShowDropDown(!showDropdown);
// 									}}
// 								>
// 									{user.user_metadata?.avatar_url ? (
// 										<img
// 											src={imgElement}
// 											alt="profile"
// 											className="w-8 h-8 rounded-full object-cover profileimg"
// 										/>
// 									) : (
// 										{ userelement: userElement }
// 									)}
// 								</button>
// 								{showDropdown && (
// 									<div className="dropdown-content " ref={dropdownRef}>
// 										<div className="user-info">
// 											<p className="user-name">
// 												{user.user_metadata?.full_name || "User"}
// 											</p>
// 											<p className="user-email">{user.email}</p>
// 										</div>
// 										<div className="line"></div>

// 										<button onClick={handleLogout} className="logout-button">
// 											{Signout}
// 											Logout
// 										</button>
// 									</div>
// 								)}

// 							</div>
// 						)}
// 						{/* {showSignUp && <Auth handle={handleButtonClick} />} */}
// 					</div>
// 					<div></div>
// 				</div>
// 			</Header>
// 			<main>
// 				<Outlet /> {/* This renders the child components */}
// 			</main>
// 			<Footer className="footerFixed">
// 				<div style={{ float: "right", lineHeight: 0 }}>
// 					<p>&copy; {new Date().getFullYear()} GPT LAB. All rights reserved.</p>
// 				</div>
// 			</Footer>
// 		</div>
// 	);
// };

// export default Layout;




import { Outlet, useNavigate } from "react-router-dom";
import { Footer, Header } from "antd/es/layout/layout";
import { RQicon } from "../mysvg";
// for authentication
import { useState, useRef, useEffect } from "react";
import { useAuth } from "./authUserContext.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser, faSignOut, faTrash } from "@fortawesome/free-solid-svg-icons";
import supabase from '../../services/supabase/supabaseclient.jsx';
import { logoutUser } from '../../utils/authLogout';
import { APP_URLS } from '../../config/baseUrls.js';
// import { useLocation } from "react-router-dom";
import './Layout.css'

const Layout = () => {
	const userElement = <FontAwesomeIcon icon={faUser} />;
	const Signout = <FontAwesomeIcon icon={faSignOut} />;
	const DeleteIcon = <FontAwesomeIcon icon={faTrash} />;

	const [showSignUp, setShowSignUp] = useState(false);
	const { user } = useAuth();
	const [showDropdown, setShowDropDown] = useState(false);
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [deleteError, setDeleteError] = useState("");

	const profileBtnRef = useRef();
	const dropdownRef = useRef();
	const imgElement = user?.user_metadata.picture ?? null;
	// const location = useLocation();
	// const pathName = location.pathname;
	const navigate = useNavigate();

	// handling logging out the user
	const handleLogout = () => {
		logoutUser();
	};

	// handling full account deletion
	const handleDeleteAccount = async () => {
		setDeleteLoading(true);
		setDeleteError("");
		try {
			const { data: { session } } = await supabase.auth.getSession();
			if (!session) throw new Error("No active session found.");

			// Call a Supabase Edge Function or RPC to delete user from auth.users
			// Option A: Using a Supabase Edge Function named 'delete-user'
			const response = await fetch(
				APP_URLS.supabaseEdgeFunction("delete-user"),
				{
					method: "DELETE",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${session.access_token}`,
					},
				}
			);

			if (!response.ok) {
				const errData = await response.json();
				throw new Error(errData.message || "Failed to delete account.");
			}

			// Sign out and clear everything
			await supabase.auth.signOut();
			localStorage.clear();
			setShowDeleteModal(false);
			window.location.href = "/";
		} catch (error) {
			console.error("Error deleting account:", error);
			setDeleteError(error.message || "Something went wrong. Please try again.");
		} finally {
			setDeleteLoading(false);
		}
	};

	// for toggling effect of dropdown
	useEffect(() => {
		const handleWindowClick = (event) => {
			if (
				(dropdownRef.current && !dropdownRef.current.contains(event.target)) &&
				(profileBtnRef.current && !profileBtnRef.current.contains(event.target))
			) {
				setShowDropDown(false);
			}
		};

		if (showDropdown) {
			window.addEventListener("click", handleWindowClick);
		}

		return () => {
			window.removeEventListener("click", handleWindowClick);
		};
	}, [showDropdown]);

	const authBtnRef = useRef(null);

	useEffect(() => {
		if (authBtnRef.current) {
			if (user) {
				authBtnRef.current.classList.remove("before-btn");
				authBtnRef.current.classList.add("btn");
			} else {
				authBtnRef.current.classList.remove("btn");
				authBtnRef.current.classList.add("before-btn");
			}
		}
	}, [user]);

	return (
		<div>
			<Header style={{ backgroundColor: "#f3fff3", overflow: 'hidden' }}>
				<div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", marginLeft: "0px" }}>
					<div>
						<RQicon width={"60px"} height={"60px"} />
					</div>
					<div style={{ fontSize: "20px", color: "black", marginLeft: '350px' }}>
						<strong>Multi-Agent Requirement Tool</strong>
					</div>
					<div className="element">
						{!showSignUp && !user && (
							<button
								ref={authBtnRef}
								className="btn before-btn"
								onClick={() => navigate("/login")}
							>
								Sign Up/Log in
							</button>
						)}
						{!showSignUp && user && (
							<div>
								<button
									className="btn btnflex"
									ref={profileBtnRef}
									onClick={() => setShowDropDown(!showDropdown)}
								>
									{user.user_metadata?.avatar_url ? (
										<img
											src={imgElement}
											alt="profile"
											className="w-8 h-8 rounded-full object-cover profileimg"
										/>
									) : (
										{ userelement: userElement }
									)}
								</button>

								{showDropdown && (
									<div className="dropdown-content" ref={dropdownRef}>
										<div className="user-info">
											<p className="user-name">
												{user.user_metadata?.full_name || "User"}
											</p>
											<p className="user-email">{user.email}</p>
										</div>
										<div className="line"></div>

										<button onClick={handleLogout} className="logout-button">
											{Signout}
											Logout
										</button>

										<div className="line"></div>

										<button
											onClick={() => {
												setShowDropDown(false);
												setShowDeleteModal(true);
											}}
											className="delete-account-button"
										>
											{DeleteIcon}
											Delete Account
										</button>
									</div>
								)}
							</div>
						)}
					</div>
					<div></div>
				</div>
			</Header>

			<main>
				<Outlet />
			</main>

			<Footer className="footerFixed">
				<div style={{ float: "right", lineHeight: 0 }}>
					<p>&copy; {new Date().getFullYear()} GPT LAB. All rights .</p>
				</div>
			</Footer>

			{/* Delete Account Confirmation Modal */}
			{showDeleteModal && (
				<div className="modal-overlay" onClick={() => !deleteLoading && setShowDeleteModal(false)}>
					<div className="modal-box" onClick={(e) => e.stopPropagation()}>
						<div className="modal-icon">🗑️</div>
						<h2 className="modal-title">Delete Account</h2>
						<p className="modal-desc">
							Are you sure you want to permanently delete your account?
							This action <strong>cannot be undone</strong> and all your data will be lost.
						</p>

						{deleteError && (
							<p className="modal-error">{deleteError}</p>
						)}

						<div className="modal-actions">
							<button
								className="modal-cancel-btn"
								onClick={() => {
									setShowDeleteModal(false);
									setDeleteError("");
								}}
								disabled={deleteLoading}
							>
								Cancel
							</button>
							<button
								className="modal-delete-btn"
								onClick={handleDeleteAccount}
								disabled={deleteLoading}
							>
								{deleteLoading ? "Deleting..." : "Yes, Delete My Account"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default Layout;