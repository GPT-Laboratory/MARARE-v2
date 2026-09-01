/**
 * Displays team MVP/Vision blocks during collaborative sessions.
 * File: src/components/meeting/TeamSection.jsx
 */
import { Card, Typography } from "antd";
import { GiArtificialHive } from "react-icons/gi";
import { EyeOutlined, RocketOutlined, TeamOutlined, DollarOutlined, ApartmentOutlined, FieldTimeOutlined } from "@ant-design/icons";

const { Title } = Typography;

// ✅ Reusable card component for text content
const InfoCard = ({ icon, title, content, teamColor }) => (
  <Card
    className="shadow-md border-0 transition-all duration-300 hover:shadow-xl"
    style={{
      borderRadius: "16px",
      background: "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)",
      border: `1px solid ${teamColor.border}`,
      height: "260px",
    }}
    bodyStyle={{ padding: "0", height: "100%" }}
  >
    <div
      className="p-4"
      style={{
        background: `linear-gradient(135deg, ${teamColor.bg} 0%, ${teamColor.bgSecondary} 100%)`,
        borderBottom: `1px solid ${teamColor.border}`,
      }}
    >
      <div className="flex items-center">
        {icon}
        <Title level={5} className="mb-0 text-gray-800 font-semibold">
          {title}
        </Title>
      </div>
    </div>
    <div className="p-4 overflow-y-auto" style={{ height: "calc(100% - 60px)" }}>
      <div className="text-gray-700 leading-relaxed text-sm">
        {content || <span className="text-gray-400 italic">No {title.toLowerCase()} available yet</span>}
      </div>
    </div>
  </Card>
);

// ✅ Compact card component for numerical data
const NumberCard = ({ icon, title, content, teamColor }) => (
    console.log("content in number",content),
    
  <Card
    className="shadow-md border-0 transition-all duration-300 hover:shadow-xl"
    style={{
      borderRadius: "12px",
      background: "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)",
      border: `1px solid ${teamColor.border}`,
      height: "80px",
    }}
    bodyStyle={{ padding: "16px", height: "100%" }}
  >
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="flex items-center justify-center mb-2">
        {icon}
        <span className="text-xs text-gray-600 font-medium ml-2">{title}</span>
      </div>
      <div className="text-2xl font-bold text-gray-800">
        {content || <span className="text-gray-400 text-sm">--</span>}
      </div>
    </div>
  </Card>
);

const TeamSectionData = ({ teamName, teamColor, visionContent, mvpContent, hrContent, cvContent, sismContent, latencyContent }) => (
  <div className="md:w-[30%] mb-8">
    {/* Header */}
    <div className="flex items-center mb-4">
      <div
        className="p-3 rounded-xl mr-4 shadow-sm"
        style={{ backgroundColor: teamColor.iconBg, color: teamColor.text }}
      >
        <GiArtificialHive style={{ fontSize: "24px" }} />
      </div>
      <Title level={3} className="mb-0 text-gray-800 font-semibold">
        {teamName}
      </Title>
    </div>

    {/* Numerical Data Cards - Horizontal Row */}
    <div className="grid grid-cols-2 gap-3 mb-6">
      <NumberCard
        icon={<TeamOutlined style={{ fontSize: "16px", color: teamColor.text }} />}
        title="Hallucination"
        content={hrContent}
        teamColor={teamColor}
      />
      <NumberCard
        icon={<DollarOutlined style={{ fontSize: "16px", color: teamColor.text }} />}
        title="Coverage"
        content={cvContent}
        teamColor={teamColor}
      />
      <NumberCard
        icon={<ApartmentOutlined style={{ fontSize: "16px", color: teamColor.text }} />}
        title="Semantic Similarity"
        content={sismContent}
        teamColor={teamColor}
      />
      {/* <NumberCard
        icon={<FieldTimeOutlined style={{ fontSize: "16px", color: teamColor.text }} />}
        title="Latency"
        content={latencyContent}
        teamColor={teamColor}
      /> */}
    </div>

    {/* Text Content Cards - Vertical Stack */}
    <div className="grid grid-cols-1 gap-6">
      <InfoCard
        icon={<EyeOutlined style={{ fontSize: "18px", color: teamColor.text, marginRight: "8px" }} />}
        title="Vision Statement"
        content={visionContent}
        teamColor={teamColor}
      />
      <InfoCard
        icon={<RocketOutlined style={{ fontSize: "18px", color: teamColor.text, marginRight: "8px" }} />}
        title="MVP Strategy"
        content={mvpContent}
        teamColor={teamColor}
      />
    </div>
  </div>
);

export default TeamSectionData;