/**
 * Workspace-specific layout shell for nested project views.
 * File: src/components/layout/workspace/Layout.jsx
 */
import React from "react";
import { RQicon } from '../../../assets/mysvg';
import { Layout as AntLayout } from "antd";
import "../../../styles/app2/App.css";
const { Header, Footer, Content } = AntLayout;

export const Layout = ({ children }) => {
  return (
    <AntLayout style={{ minHeight: "100vh" }}>
      <Header style={{ backgroundColor: "#f3fff3", display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div>
            <RQicon width={"60px"} height={"60px"} />
          </div>
          <div style={{ fontSize: "20px", color: "black", fontWeight: "bold" }}>
            Multi-Agent GPT Project Workspace
          </div>
          <div></div>
        </div>
      </Header>
      <Content style={{ padding: "20px" }}>{children}</Content>
      <Footer style={{ textAlign: "right", backgroundColor: "#f3fff3", padding: "10px" }}>
        <p>&copy; {new Date().getFullYear()} GPT LAB. All rights .</p>
      </Footer>
    </AntLayout>
  );
};

export default Layout;
