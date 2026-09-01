/**
 * Public landing page for guests before login.
 * File: src/pages/home/HomePage.jsx
 */
import React from 'react';
import { Button, Card } from 'antd';
import { 
  CalendarOutlined, 
  BarChartOutlined, 
} from '@ant-design/icons';

const HomePage = ({ onLogin, onRegister }) => {
  const features = [
    {
      icon: <CalendarOutlined className="text-blue-500 text-2xl" />,
      title: 'Smart Meetings',
      description: 'Create and organize your Projects Meetings'
    },
    {
      icon: <BarChartOutlined className="text-blue-500 text-2xl" />,
      title: 'Project Reports',
      description: 'Create Project reports using AI Models'
    }
  ];

  const handleLogin = () => {
    if (onLogin) onLogin();
  };

  const handleRegister = () => {
    if (onRegister) onRegister();
  };

 

  return (
    <div className="  ">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left Section - Main Content */}
          <div className="space-y-8">
            <div className="space-y-6">
              <h1 className="text-4xl lg:text-5xl font-bold text-gray-900  leading-tight">
                Your AI-Powered
                <br />
                <span className="text-blue-600">Requirement Engineering</span>
                <br />
                Assistant
              </h1>
              
              <p className="text-lg text-gray-600  leading-relaxed max-w-lg">
                Create, organize, and collaborate on your notes with the power of AI. 
                Transform your ideas into actionable insights with our intelligent notebook platform.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-4">
              <Button 
                type="primary" 
                size="large"
                onClick={handleLogin}
                className="bg-blue-600  hover:bg-blue-700 border-blue-600 hover:border-blue-700 px-8 py-2 h-12 text-base font-medium"
              >
                Login
              </Button>
              <Button 
                type="default" 
                size="large"
                onClick={handleRegister}
                className="border-gray-300 text-gray-700 hover:border-blue-500 hover:text-blue-500 px-8 py-2 h-12 text-base font-medium"
              >
                Register
              </Button>
            </div>
          </div>

          {/* Right Section - Feature Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="border border-gray-200  shadow-sm hover:shadow-md transition-shadow duration-300 bg-white "
                bodyStyle={{ padding: '24px' }}
              >
                <div className="text-center space-y-4">
                  <div className="flex justify-center">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 ">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-600  leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;