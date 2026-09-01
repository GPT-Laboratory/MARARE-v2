/**
 * Root application component — defines all routes and global auth/session handling.
 *
 * Route map (high level):
 * - `/`                     → HomePage (guest) or CreateProject dashboard (logged in)
 * - `/login`, `/register`   → Auth pages
 * - `/create-meeting/:project_name/:id` → Meeting lobby (MainApp)
 * - `/:project_id/:id`      → Live meeting room (Content)
 * - `/project_details/...`  → Project hub (documents, history, connectors)
 * - `/document-template`, `/mvp-template` → Pre-meeting template editors
 * - `/endmeeting/:id`       → Post-meeting summary screen
 */
import React, { useEffect, useState } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { ConfigProvider, theme, App as AntApp } from "antd";
import Protectedroutes from "./pages/auth/Protectedroutes";
import Auth from "./pages/auth/Auth";
import Header from "./components/layout/Header";
import HomePage from "./pages/home/HomePage";
import UpdatePassword from "./pages/auth/updatePassword";
import CreateProject from "./pages/projects/CreateProject";
import supabase from "./services/supabase/supabaseclient";
import { linkMigratedUserIfNeeded } from "./utils/linkMigratedUser";
import MainApp from "./pages/meeting/MainApp";
import EndMeetingMessage from "./pages/meeting/EndMeetingMessage";
import Content from "./pages/meeting/Content";

import "./styles/app2/App.css";
import './App.css';
import ProjectDetails from './pages/projects/ProjectDetails';
import GeneratedDocumentPage from './pages/projects/GeneratedDocumentPage';
import { Footer } from 'antd/es/layout/layout';
import ProjectMcpConfigurationPage from "./pages/projects/ProjectMcpConfigurationPage";
import Template from "./pages/templates/Template";
import MVPVISIONTemplate from "./pages/templates/MVPVISIONTemplate";
import TermsAndConditions from "./pages/legal/TermsAndConditions";
import TermsPopup from "./pages/legal/TermsPopup";
import { useTheme } from "./context/ThemeContext";



/** Shared shell: header, main content area, footer. Injects login/register handlers into child pages. */
/** Shared shell: header, main content area, footer. Injects login handlers into child pages. */
const Layout = ({ children, isLoggedIn, setIsLoggedIn }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogin = () => navigate("/login");
  const handleRegister = () => navigate("/register");
  const handler = () => {
    handleLogin();
  };


  return (
      <div className={`app-shell ${isDarkMode ? "app-theme-dark" : "app-theme-light"}`}>
        <div className="layout-wrapper">
            <Header
            isDarkMode={isDarkMode}
            toggleTheme={toggleTheme}
            isLoggedIn={isLoggedIn}
            onLogin={handleLogin}
            handler={handler}
        />
  

          <main className="layout-content">
            {React.cloneElement(children, {
              onLogin: handleLogin,
              onRegister: handleRegister,
              setIsLoggedIn,
            })}
          </main>


          <Footer className="layout-footer">
            <div className="layout-footer-content">
              <div style={{ marginRight: '10px' }}>
                <a 
                  href="/terms-and-conditions" 
                  className="layout-footer-link"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/terms-and-conditions');
                  }}
                >
                  Terms & Conditions
                </a>
              </div>
              <p>&copy; {new Date().getFullYear()} GPT LAB. All rights reserved.</p>
            </div>
          </Footer>

        </div>
      </div>

  );
};

const App = () => {
  // Tracks Supabase login state for header UI and route guards
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showTermsPopup, setShowTermsPopup] = useState(false);
  const [user, setUser] = useState(null);
  const { isDarkMode } = useTheme();

  // Restore session on load and subscribe to login/logout events
  // Restore session on load and subscribe to login/logout events
  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        setIsLoggedIn(true);
        setUser(data.session.user);
        linkMigratedUserIfNeeded(data.session.user);
      }
    };
    checkSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsLoggedIn(!!session);
        setUser(session?.user || null);
        if (session?.user) {
          linkMigratedUserIfNeeded(session.user);
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user && localStorage.getItem("showTermsPopup") === "true") {
      setShowTermsPopup(true);
    }
  }, [user]);

  const handleCloseTerms = () => {
    setShowTermsPopup(false);
    localStorage.removeItem("showTermsPopup");
  };

  const isSignup = true;

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <AntApp>
      <div className={`app-root ${isDarkMode ? "app-theme-dark" : "app-theme-light"}`}>
      <BrowserRouter>
        <TermsPopup visible={showTermsPopup} onClose={handleCloseTerms} />
        <Routes>
        <Route
          path="/login"
          element={
            <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
              <Auth setIsLoggedIn={setIsLoggedIn} />
            </Layout>
          }
        />
        

        <Route
          path="/register"
          element={
            <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
              <Auth setIsLoggedIn={setIsLoggedIn} isSignup={isSignup} />
            </Layout>
          }
        />
        <Route
          path="/:project_name/:project_id/connectors"
          element={
            <Protectedroutes>
              <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
                <ProjectMcpConfigurationPage />
              </Layout>
            </Protectedroutes>
          }
        />

        <Route
          path="/"
          element={
            isLoggedIn ? (
              <Protectedroutes>
                <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
                  <CreateProject />
                </Layout>
              </Protectedroutes>
            ) : (
              <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
                <HomePage />
              </Layout>
            )
          }
        />

        <Route
          path="/create-meeting/:project_name/:id"
          element={
            <Protectedroutes>
              <Layout>
                <MainApp />
              </Layout>
            </Protectedroutes>
          }
        />

        <Route
          path="/document-template/:project_name/:id"
          element={
            <Protectedroutes>
              <Layout>
                <Template/>
              </Layout>
            </Protectedroutes>
          }
        />

        <Route
          path="/mvp-template/:project_name/:id"
          element={
            <Protectedroutes>
              <Layout>
                <MVPVISIONTemplate/>
              </Layout>
            </Protectedroutes>
          }
        />
        <Route
          path="/endmeeting/:id"
          element={
            <Protectedroutes>
              <Layout>
                <EndMeetingMessage />
              </Layout>
            </Protectedroutes>
          }
        />

        <Route
          path="/:project_id/:id"
          element={
            <Protectedroutes>
              <Content />
            </Protectedroutes>
          }
        />
        <Route
          path="/project_details/:project_name/:id"
          element={
            <Protectedroutes>
              <Layout>
                {/* <App2 /> */}
                <ProjectDetails />
              </Layout>
            </Protectedroutes>
          }
        />
        <Route
          path="/project_details/:project_name/:id/document/:documentId"
          element={
            <Protectedroutes>
              <Layout>
                <GeneratedDocumentPage />
              </Layout>
            </Protectedroutes>
          }
        />
        <Route
          path="/reset-password"
          element={
            <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
              <Protectedroutes>
                <UpdatePassword />
              </Protectedroutes>
            </Layout>
          }
        />
        <Route
          path="/terms-and-conditions"
          element={
            <Layout isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn}>
              <TermsAndConditions />
            </Layout>
          }
        />
        </Routes>
      </BrowserRouter>
      </div>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
