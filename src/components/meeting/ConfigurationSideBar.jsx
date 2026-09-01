/**
 * Meeting configuration panel — teams, agent, document options.
 * File: src/components/meeting/ConfigurationSideBar.jsx
 */
import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setCurrentConfiguration } from '../../features/mainStates/MainStates_Slice';
import { APP_URLS } from '../../config/baseUrls.js';
import {
  Database,
  MessageSquare,
  FileText,
  Calendar,
  Mail,
  CheckCircle,
  Trash2,
  X,
  RefreshCw,
} from "lucide-react";

const ConfigurationSideBar = ({ toggleBar, toggleBarState }) => {
  const [selectedTool, setSelectedTool] = useState("");
  const [configurations, setConfigurations] = useState({});
  const dispatch = useDispatch();
  const currentConfig = useSelector((state) => state.MainStates_Slice.currentConfiguration);
  console.log("Current configuration in sidebar:", currentConfig);

  // Function to update currentConfig in Redux
  const setCurrentConfig = (config) => {
    dispatch(setCurrentConfiguration(config));
  };
  const [availableTools, setAvailableTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(()=>{
    console.log("configuration at sidebar", configurations)
  },[configurations])
  // Fetch tools from API
  const fetchTools = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${APP_URLS.mcpServer}/tools`);
      const data = await response.json();
      setAvailableTools(data.tools || []);
      console.log("Available tools:", data.tools);
    } catch (err) {
      console.error("Error fetching tools:", err);
      setError("Failed to load tools");
      // Fallback to mock data if API fails
      setAvailableTools([
        {
          id: "notion",
          name: "Notion",
          icon: <Database className="w-5 h-5" />,
          description: "Connect to Notion workspace",
          configFields: [
            {
              name: "databaseId",
              label: "Database ID",
              type: "text",
              required: true,
            },
            {
              name: "apiKey",
              label: "API Key",
              type: "password",
              required: true,
            },
          ],
        },
        {
          id: "slack",
          name: "Slack",
          icon: <MessageSquare className="w-5 h-5" />,
          description: "Connect to Slack workspace",
          configFields: [
            {
              name: "botToken",
              label: "Slack Bot Token",
              type: "password",
              required: true,
            },
          ],
        },
        {
          id: "google-docs",
          name: "Google Docs",
          icon: <FileText className="w-5 h-5" />,
          description: "Connect to Google Docs",
          configFields: [
            {
              name: "clientId",
              label: "Client ID",
              type: "text",
              required: true,
            },
            {
              name: "clientSecret",
              label: "Client Secret",
              type: "password",
              required: true,
            },
          ],
        },
        {
          id: "calendar",
          name: "Calendar",
          icon: <Calendar className="w-5 h-5" />,
          description: "Connect to calendar service",
          configFields: [
            {
              name: "calendarId",
              label: "Calendar ID",
              type: "text",
              required: true,
            },
            {
              name: "apiKey",
              label: "API Key",
              type: "password",
              required: true,
            },
          ],
        },
        {
          id: "email",
          name: "Email",
          icon: <Mail className="w-5 h-5" />,
          description: "Connect to email service",
          configFields: [
            {
              name: "smtpServer",
              label: "SMTP Server",
              type: "text",
              required: true,
            },
            {
              name: "username",
              label: "Username",
              type: "text",
              required: true,
            },
            {
              name: "password",
              label: "Password",
              type: "password",
              required: true,
            },
          ],
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Manual refresh function
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTools();
  };

  // Fetch tools on component mount and when sidebar opens
  useEffect(() => {
    fetchTools();
  }, []);

  // Refetch tools whenever the sidebar opens
  useEffect(() => {
    if (toggleBarState) {
      handleRefresh();
    }
  }, [toggleBarState]);

  const handleToolSelection = (toolId) => {
    setSelectedTool(toolId);
    if (configurations[toolId]) {
      setCurrentConfig(configurations[toolId]);
    } else {
      setCurrentConfig({});
    }
  };

  const handleConfigChange = (fieldName, value) => {
    setCurrentConfig({
      ...currentConfig,
      [fieldName]: value,
    });
  };

  const saveConfiguration = () => {
    if (selectedTool) {
      setConfigurations((prev) => ({
        ...prev,
        [selectedTool]: { ...currentConfig },
      }));

      console.log(`Configuration saved for ${selectedTool}:`, currentConfig);
      alert(
        `Configuration saved for ${
          availableTools.find((t) => t.id === selectedTool)?.name
        }!`
      );
    }
  };

  const removeConfiguration = (toolId) => {
    const toolName = availableTools.find((t) => t.id === toolId)?.name;

    if (
      window.confirm(
        `Are you sure you want to remove the configuration for ${toolName}?`
      )
    ) {
      setConfigurations((prev) => {
        const newConfigs = { ...prev };
        delete newConfigs[toolId];
        return newConfigs;
      });

      // If the removed tool was currently selected, clear the selection
      if (selectedTool === toolId) {
        setSelectedTool("");
        setCurrentConfig({});
      }

      console.log(`Configuration removed for ${toolId}`);
      alert(`Configuration removed for ${toolName}!`);
    }
  };

  const getSelectedToolData = () => {
    return availableTools.find((tool) => tool.id === selectedTool);
  };

  const isConfigurationValid = () => {
    const toolData = getSelectedToolData();
    if (!toolData) return false;

    const requiredFields = toolData.configFields.filter(
      (field) => field.required
    );
    return requiredFields.every(
      (field) =>
        currentConfig[field.name] && currentConfig[field.name].trim() !== ""
    );
  };

  return (
    <>
      {/* Backdrop with blur effect */}
      {toggleBarState && (
        <div
          className="fixed inset-0 backdrop-blur-sm bg-transparent z-40 transition-all duration-300 ease-in-out"
          onClick={toggleBar}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
        fixed top-0 left-0 h-full w-96 bg-black text-white shadow-2xl z-50 border-r border-gray-800 
        transform transition-transform duration-500 ease-in-out
        ${toggleBarState ? "translate-x-0" : "-translate-x-full"}
      `}
      >
        <div className="h-full overflow-y-auto">
          <div className="p-6">
            {/* Header with close button and refresh */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                Tool Configuration
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={loading || refreshing}
                  className="bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-full p-2 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh tools"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </button>
                <button
                  onClick={toggleBar}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-full p-2 transition-colors duration-200 cursor-pointer"
                  title="Close sidebar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Loading state */}
            {loading && !refreshing && (
              <div className="flex items-center justify-center py-8">
                <div className="text-gray-400">Loading tools...</div>
              </div>
            )}

            {/* Refreshing state */}
            {refreshing && (
              <div className="flex items-center justify-center py-4 mb-4 bg-blue-50 border border-blue-200 rounded-lg">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600 mr-2" />
                <div className="text-blue-600">Refreshing tools...</div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error} - Using fallback data
              </div>
            )}

            {/* Configured Tools Section */}
            {Object.keys(configurations).length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">
                  Configured Tools
                </h3>
                <div className="space-y-2">
                  {Object.keys(configurations).map((toolId) => {
                    const tool = availableTools.find((t) => t.id === toolId);
                    return (
                      <div
                        key={toolId}
                        className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-3 group"
                      >
                        {tool?.icon}
                        <span className="font-medium text-green-800 flex-1">
                          {tool?.name}
                        </span>
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <button
                          onClick={() => removeConfiguration(toolId)}
                          className="opacity-0 group-hover:opacity-100 bg-red-100 hover:bg-red-200 text-red-600 p-1 rounded transition-all duration-200"
                          title={`Remove ${tool?.name} configuration`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t my-6"></div>
              </div>
            )}

            {/* Available Tools List */}
            {!loading && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">
                  Available Tools
                </h3>
                <div className="space-y-3">
                  {availableTools.map((tool) => (
                    <div
                      key={tool.id}
                      className={`border rounded-lg p-3 cursor-pointer transition-all duration-200 ${
                        selectedTool === tool.id
                          ? "border-blue-500 bg-gray-900"
                          : "border-gray-700 hover:border-gray-600 bg-gray-900"
                      } ${configurations[tool.id] ? "opacity-60" : ""}`}
                    >
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="tool"
                          value={tool.id}
                          checked={selectedTool === tool.id}
                          onChange={() => handleToolSelection(tool.id)}
                          className="text-blue-600"
                        />
                        <div className="flex items-center gap-2 flex-1">
                          {tool.icon}
                          <div>
                            <div className="font-medium text-white">
                              {tool.name}
                            </div>
                            <div className="text-sm text-gray-400">
                              {tool.description}
                            </div>
                          </div>
                        </div>
                        {configurations[tool.id] && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                            ✓
                          </span>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Configuration Form */}
            {selectedTool && !loading && (
              <div className="border-t pt-6">
                <h3 className="font-semibold text-white mb-4">
                  Configure {getSelectedToolData()?.name}
                </h3>

                <div className="space-y-4">
                  {getSelectedToolData()?.configFields.map((field) => (
                    <div key={field.name}>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        {field.label}
                        {field.required && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </label>
                      <input
                        type={field.type}
                        value={currentConfig[field.name] || ""}
                        onChange={(e) =>
                          handleConfigChange(field.name, e.target.value)
                        }
                        className="w-full px-3 py-2 bg-gray-900 text-white border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                      />
                    </div>
                  ))}

                  <button
                    onClick={saveConfiguration}
                    disabled={!isConfigurationValid()}
                    className={`w-full py-2 px-4 rounded-lg font-medium transition-all duration-200 ${
                      isConfigurationValid()
                        ? "bg-blue-600 text-white hover:bg-blue-700 transform hover:scale-[1.02]"
                        : "bg-gray-300 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    Save Configuration
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ConfigurationSideBar;
