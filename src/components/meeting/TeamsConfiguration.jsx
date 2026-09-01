/**
 * Configure team names/colors before or during meeting.
 * File: src/components/meeting/TeamsConfiguration.jsx
 */
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { Drawer, Card, Typography } from "antd";
import { SettingOutlined, CloseOutlined } from "@ant-design/icons";
import { GiArtificialHive } from "react-icons/gi";
// import { updateTeamAgent } from '../../features/mainStates/TeamConfigSlice';
// import { updateTeamAgent } from "../redux/slices/teamConfigSlice"; // adjust import path

const { Title } = Typography;

const ConfigurationDrawer = ({ open, onClose }) => {
    const teamConfig = useSelector((state) => state.teamConfig);
    const dispatch = useDispatch();

    const modelOptions = {
        teamA: [
            { value: "llama3.1:latest", label: "Llama 3.1 Latest" },
            { value: "llama2:latest", label: "Llama 2 Latest" },
            { value: "llama3:latest", label: "Llama 3 Latest" },
        ],
        teamB: [
            { value: "mistral:latest", label: "Mistral Latest" },
            { value: "mistral:7b", label: "Mistral 7B" },
            { value: "mistral:instruct", label: "Mistral Instruct" },
        ],
        teamC: [
            { value: "gpt-5.4-2026-03-05", label: "GPT-3.5 Turbo" },
            { value: "gpt-5.4-2026-03-05", label: "gpt-5.4-2026-03-05" },
            { value: "gpt-5.4-2026-03-05", label: "gpt-5.4-2026-03-05 Mini" },
        ],
    };

    const modelTypes = [
        { value: "simple", label: "Simple" },
        { value: "reasoning", label: "Reasoning" },
    ];

    const handleConfigChange = (team, agent, field, value) => {
        dispatch(updateTeamAgent({ team, agent, field, value }));
    };

    const TeamConfigSection = ({ teamKey, teamName, teamColor }) => (
        <div className=" mb-8">
            <div className="flex items-center mb-4">
                <div
                    className="p-3 rounded-xl mr-4 shadow-sm"
                    style={{ backgroundColor: teamColor.iconBg, color: teamColor.text }}
                >
                    <GiArtificialHive style={{ fontSize: "24px" }} />
                </div>
                <Title level={4} className="mb-0 text-gray-800 font-semibold">
                    {teamName}
                </Title>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Agent 1 (Executor) */}
                <Card
                    className="mb-4 shadow-sm border-0"
                    style={{
                        borderRadius: "12px",
                        border: `1px solid ${teamColor.border}`,
                    }}
                    title={
                        <div className="flex items-center">
                            <span className="mr-2">🤖</span>
                            <span className="font-medium">Executor Agent</span>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        {/* Model Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Model Selection
                            </label>
                            <select
                                value={teamConfig[teamKey].agent1.model}
                                onChange={(e) =>
                                    handleConfigChange(teamKey, "agent1", "model", e.target.value)
                                }
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {modelOptions[teamKey].map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Model Type */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Model Type
                            </label>
                            <select
                                value={teamConfig[teamKey].agent1.modelType}
                                onChange={(e) =>
                                    handleConfigChange(
                                        teamKey,
                                        "agent1",
                                        "modelType",
                                        e.target.value
                                    )
                                }
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {modelTypes.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Prompt */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Prompt
                            </label>
                            <textarea
                                value={teamConfig[teamKey].agent1.prompt}
                                onChange={(e) =>
                                    handleConfigChange(teamKey, "agent1", "prompt", e.target.value)
                                }
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                rows={3}
                                placeholder="Enter agent prompt..."
                            />
                        </div>
                    </div>
                </Card>

                {/* Agent 2 (Verifier) */}
                <Card
                    className="shadow-sm border-0"
                    style={{
                        borderRadius: "12px",
                        border: `1px solid ${teamColor.border}`,
                    }}
                    title={
                        <div className="flex items-center">
                            <span className="mr-2">🔍</span>
                            <span className="font-medium">Verifier Agent</span>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        {/* Model Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Model Selection
                            </label>
                            <select
                                value={teamConfig[teamKey].agent2.model}
                                onChange={(e) =>
                                    handleConfigChange(teamKey, "agent2", "model", e.target.value)
                                }
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {modelOptions[teamKey].map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Model Type */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Model Type
                            </label>
                            <select
                                value={teamConfig[teamKey].agent2.modelType}
                                onChange={(e) =>
                                    handleConfigChange(
                                        teamKey,
                                        "agent2",
                                        "modelType",
                                        e.target.value
                                    )
                                }
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {modelTypes.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Prompt */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Prompt
                            </label>
                            <textarea
                                value={teamConfig[teamKey].agent2.prompt}
                                onChange={(e) =>
                                    handleConfigChange(teamKey, "agent2", "prompt", e.target.value)
                                }
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                rows={3}
                                placeholder="Enter agent prompt..."
                            />
                        </div>
                    </div>
                </Card>
            </div>


        </div>
    );

    return (
        <Drawer
            title={
                <div className="flex items-center py-2">
                    <div className="p-3 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl mr-4 shadow-sm">
                        <SettingOutlined style={{ color: "#7c3aed", fontSize: "22px" }} />
                    </div>
                    <div>
                        <span
                            style={{ color: "#1f2937", fontSize: "20px", fontWeight: "600" }}
                        >
                            Team Configuration
                        </span>
                        <div className="text-sm text-gray-500 font-normal">
                            Configure AI agents for each team
                        </div>
                    </div>
                </div>
            }
            placement="right"
            onClose={onClose}
            open={open}
            width={900}
            headerStyle={{
                borderBottom: "2px solid #e5e7eb",
                padding: "20px 24px",
                background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
            }}
            bodyStyle={{
                padding: "24px",
                backgroundColor: "#fafbfc",
                background: "linear-gradient(180deg, #fafbfc 0%, #f1f5f9 100%)",
            }}
            closeIcon={
                <CloseOutlined style={{ fontSize: "18px", color: "#6b7280" }} />
            }
        >
            <div className="space-y-8">
                <TeamConfigSection
                    teamKey="teamA"
                    teamName="Team A (Ollama Models)"
                    teamColor={{
                        bg: "#fef3f2",
                        bgSecondary: "#fee2e2",
                        iconBg: "#ffffff",
                        text: "#dc2626",
                        border: "#fca5a5",
                    }}
                />

                <TeamConfigSection
                    teamKey="teamB"
                    teamName="Team B (Mistral Models)"
                    teamColor={{
                        bg: "#f0fdf4",
                        bgSecondary: "#dcfce7",
                        iconBg: "#ffffff",
                        text: "#16a34a",
                        border: "#86efac",
                    }}
                />

                <TeamConfigSection
                    teamKey="teamC"
                    teamName="Team C (OpenAI Models)"
                    teamColor={{
                        bg: "#f0f9ff",
                        bgSecondary: "#e0f2fe",
                        iconBg: "#ffffff",
                        text: "#0284c7",
                        border: "#7dd3fc",
                    }}
                />
            </div>
        </Drawer>
    );
};

export default ConfigurationDrawer;
