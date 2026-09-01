/**
 * Modal to create or edit a project.
 * File: src/components/projects/CreateProjectModal.jsx
 */
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { createProject } from "../../features/MainSlice.jsx";
import {
  Modal,
  Form,
  Input,
  Button,
  message,
  Space,
} from "antd";
import {
  ProjectOutlined,
  PlusOutlined,
  EditOutlined,
  BarChartOutlined,
  TeamOutlined,
  UserOutlined,
  BulbOutlined,
  FileTextOutlined,

} from "@ant-design/icons";

const CreateProjectModal = ({ visible, onCancel, onSuccess, editingProject, onUpdate }) => {
  const dispatch = useDispatch();
  const [form] = Form.useForm();
  const { loading } = useSelector((state) => state.main);
  const [mvpVisiontemplate] = useState([
    {
      id: "mvp",
      title: "MVP",
      content: "You are a research assistant AI agent responsible for generating research questions, analyzing and summarizing research papers, applying inclusion and exclusion criteria for literature review, extracting key data, supporting qualitative and quantitative analysis, answering research queries, and assisting in creating research documents such as abstracts, introductions, and LaTeX summaries with clear and structured academic responses.",
      category: "MVP",
    },
    {
      id: "vision",
      title: "Vision",
      content: "You are an advanced AI research assistant designed to automate the research workflow by discovering relevant papers from external sources, performing intelligent literature reviews using inclusion and exclusion criteria, synthesizing insights from multiple papers, generating high-quality academic content such as abstracts, introductions and literature reviews, supporting qualitative and quantitative analysis, answering complex research questions, and producing structured LaTeX-ready research outputs.",
      category: "Vision",
    }
  ]);

  const [template] = useState([
    // OVERVIEW SECTIONS - PRE-FILLED
    {
      id: "purpose",
      title: "Purpose",
      content: "This document defines the strategic intent of the program. It defines high-level user needs, any applicable user personas, key stakeholders, and the general system capabilities needed by the users.",
      category: "Introduction",
      icon: "FileTextOutlined"
    },
    {
      id: "solution_overview",
      title: "Solution Overview",
      content: "State the general purpose of the product, system, application or service, and any version identification.  Identify the product or application to be created or enhanced.  Describe the application of the product, including its benefits, goals, and objectives.  Provide a general description of what the solution will and, where appropriate, will not do.",
      category: "Introduction",
      icon: "BulbOutlined"
    },
    // {
    //   id: "References",
    //   title: "References",
    //   content: "List other documents referenced, and specify the sources from which the references can be obtained. If a business case (Chapter 23) was developed to drive the program, refer to it or attach it.",
    //   category: "Introduction",
    //   icon: "BulbOutlined"
    // },

    // USER ANALYSIS SECTIONS - PRE-FILLED
    {
      id: "User/Market_Demographics",
      title: "User/Market Demographics",
      content: "Summarize the key market demographics that motivate your solution decisions. Describe target-market segments. Estimate the market’s size and growth by the number of potential users or the amount of money your customers spend, trying to meet needs that your product/enhancement would fulfill. Review major industry trends and technologies. Refer to a market analysis, where available.",
      category: "User_Description",
      icon: "UserOutlined"
    },
    {
      id: "user_personas",
      title: "User Personas",
      content: "Describe the primary and secondary user personas (see Chapter 7). A thorough analysis might cover the following topics for each persona: Technical background and degree of sophistication; Key responsibilities; Deliverables the user produces and for whom; Trends that make the user’s job easier or more difficult; The user’s definition of success and how the user is rewarded; Problems that interfere with success",
      category: "User_Description",
      icon: "TeamOutlined"
    },
    {
      id: "User_Environment",
      title: "User Environment",
      content: "Describe the working environment of the target user. Here are some suggestions: How many people are involved in completing the task? Is this changing? How long is a task cycle? How much time is spent in each activity? Is this changing? Are there any unique environmental constraints: controlled environment, mobile, outdoors, and so on? Which system platforms are in use today? Future platforms? What other applications are in use? Does your application need to integrate with them?",
      category: "User_Description",
      icon: "TeamOutlined"
    },
    {
      id: "Key_User_Needs",
      title: "Key User Needs",
      content: "List the key problems or needs as perceived by the user. Clarify the following issues for each problem: What are the reasons for this problem? How is it solved now? What solutions does the user envision? Ranking and cumulative-voting techniques for these needs indicate problems that must be solved versus issues the user would like to be solved.",
      category: "User_Description",
      icon: "TeamOutlined"
    },
    // {
    //   id: "Alternatives_and_Competition",
    //   title: "Alternatives and Competition",
    //   content: "Describe the working environment of the target user. Here are some suggestions: How many people are involved in completing the task? Is this changing? How long is a task cycle? How much time is spent in each activity? Is this changing? Are there any unique environmental constraints: controlled environment, mobile, outdoors, and so on? Which system platforms are in use today? Future platforms? What other applications are in use? Does your application need to integrate with them?",
    //   category: "User_Description",
    //   icon: "TeamOutlined"
    // },




    {
      "id": "Stakeholders",
      "title": "Stakeholders",
      "content": "Identify the program stakeholders, their needs, and their degree of involvement with the system. A table such as the following can be effective:Project StakeholdertDegree of InvolvementProduct Needs Program Needs Stakeholder 1  Stakeholder 2 ",
      "category": "Stakeholders",
      "icon": "UserOutlined "
    },
    {
      "id": "Product_Overview",
      "title": "Product Overview",
      "content": "This section provides a high-level view of the solution capabilities, interfaces to other applications, and systems configurations. This section usually consists of five subsections, as follows.",
      "category": "Product_Overview",
      "icon": "UserOutlined "
    },
    {
      "id": "Product_Perspective",
      "title": "Product Perspective",
      "content": "This subsection should put the product in perspective to other related products and the user’s environment. If the product is independent and totally self-contained, state so. If the product is a component of a larger system, this subsection should relate how these systems interact and should identify the relevant interfaces among the systems. One easy way to display the major components of the larger system, interconnections, and external interfaces is via a system context block diagram.",
      "category": "Product_Overview",
      "icon": "UserOutlined "
    },
    {
      "id": "Product_Position_Statement",
      "title": "Product Position Statement",
      "content": "Provide an overall statement summarizing, at the highest level, the unique position the product intends to fill in the marketplace. Moore (1991) calls this the product position statement and recommends the following format:  For (target customer) Who (statement of the need or opportunity) The (product name) is a (product category) That (statement of key benefit, that is, compelling reason to buy) Unlike (primary competitive alternative) Our product (statement of primary differentiation)  A product position statement communicates the intent of the application and the importance of the program to all stakeholders.",
      "category": "Product_Overview",
      "icon": "UserOutlined "
    },
    {
      "id": "Summary_of_Capabilities",
      "title": "Summary of Capabilities",
      "content": "Summarize the major benefits and features the product will provide. Organize the features so that the list is understandable to any stakeholder. A simple table listing the key benefits and their supporting features, as shown below, might suffice.  Solution Features Customer Benefit Feature 1 Benefit 1 Feature 2 Benefit 2",
      "category": "Product_Overview",
      "icon": "UserOutlined "
    },
    {
      "id": "Assumptions_and_Dependencies",
      "title": "Assumptions and Dependencies",
      "content": "List any assumptions that, if changed, will alter the vision for the product.",
      "category": "Product_Overview",
      "icon": "UserOutlined "
    },
    {
      "id": "Cost_and_Pricing",
      "title": "Cost and Pricing",
      "content": "Describe any relevant cost and pricing constraints, because these can directly impact the solution definition and implementation.",
      "category": "Product_Overview",
      "icon": "UserOutlined "
    },
    {
      "id": "Product_Features",
      "title": "Product Features",
      "content": "This section describes the intended product features. Features provide the system capabilities that are necessary to deliver benefits to the users. Feature descriptions should be short and pithy, a key phrase, perhaps followed by one or two sentences of explanation.  Use a level of abstraction high enough to be able to describe the system with a maximum of 25 to 50 features. Each feature should be perceivable by users, operators, or other external systems.",
      "category": "Product_Features",
      "icon": "UserOutlined "
    },
    // {
    //   "id": "Feature_1",
    //   "title": "Feature 1",
    //   "content": "",
    //   "category": "Product_Features",
    //   "icon": "UserOutlined "
    // },
    // {
    //   "id": "Feature_2",
    //   "title": "Feature 2",
    //   "content": "",
    //   "category": "Product_Features",
    //   "icon": "UserOutlined "
    // },
    {
      "id": "Exemplary_Use_Cases",
      "title": "Exemplary Use Cases",
      "content": "[Optional] You may want to describe a few exemplary use cases, perhaps those that are architecturally significant or those that will most readily help the reader understand how the system is intended to be used.",
      "category": "Exemplary_Use_Cases",
      "icon": "UserOutlined "
    },
    {
      "id": "Nonfunctional_Requirements",
      "title": "Nonfunctional Requirements",
      "content": "This section records other system requirements including nonfunctional requirements (constraints) imposed on the system (see Chapter 17).",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Usability",
      "title": "Usability",
      "content": "",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Reliability",
      "title": "Reliability",
      "content": "",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Performance",
      "title": "Performance",
      "content": "",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Supportability",
      "title": "Supportability",
      "content": "",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Other_Requirements",
      "title": "Other Requirements",
      "content": "",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Applicable_Standards",
      "title": "Applicable Standards",
      "content": "List all standards the product must comply with, such as legal and regulatory, communications standards, platform compliance standards, and quality and safety standards.",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "System_Requirements",
      "title": "System Requirements",
      "content": "Define any system requirements necessary to support the application. These may include the host operating systems and network platforms, configurations, communication, peripherals, and companion software.",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Licensing_Security_and_Installation",
      "title": "Licensing, Security, and Installation",
      "content": "Licensing, security, and installation issues can also directly impact the development effort. Installation requirements may affect coding or create the need for separate installation software.",
      "category": "Nonfunctional_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "User_Manual",
      "title": "User Manual",
      "content": "Describe the intent of the user manual. Discuss desired length, level of detail, need for index and glossary, tutorial versus reference manual strategy, and so on. Formatting, electronic distribution, and printing constraints should also be identified.",
      "category": "Documentation_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Online_Help",
      "title": "Online Help",
      "content": "The nature of these systems is unique to application development since they combine aspects of programming and hosting, such as hyperlinks and web services, with aspects of technical writing, such as organization, style, and presentation.",
      "category": "Documentation_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Installation_Guides_Configuration_Read_Me_File",
      "title": "Installation Guides, Configuration, “Read Me” File",
      "content": "A document that includes installation instructions and configuration guidelines is typically necessary. Also, a “read me” file is often included as a standard component. The “read me” file may include a “What’s New with This Release” section and a discussion of compatibility issues with earlier releases. Most users also appreciate publication of any known defects and workarounds.",
      "category": "Documentation_Requirements",
      "icon": "UserOutlined "
    },
    {
      "id": "Labeling_and_Packaging",
      "title": "Labeling and Packaging",
      "content": "Defines the requirements for labeling to be incorporated into the code. Examples include copyright and patent notices, corporate logos, standardized icons, and other graphic elements.",
      "category": "Documentation_Requirements",
      "icon": "UserOutlined "
    },
    // {
    //   "id": "Glossary",
    //   "title": "Glossary",
    //   "content": "The glossary defines terms that are unique to the program. Include any acronyms or abbreviations that need to be understood by users or other readers.",
    //   "category": "Glossary",
    //   "icon": "UserOutlined "
    // }




  ]);



  const [categories] = useState({
    Introduction: { title: "Introduction", color: "#1890ff" },
    User_Description: { title: "User Description", color: "#52c41a" },
    Stakeholders: { title: "Stakeholders", color: "#fa8c16" },
    Product_Overview: { title: "Product Overview", color: "#fa8c16" },
    Product_Features: { title: "Product Features", color: "#fa8c16" },
    Exemplary_Use_Cases: { title: "Exemplary Use Cases", color: "#fa8c16" },
    Nonfunctional_Requirements: { title: "Nonfunctional Requirements", color: "#fa8c16" },
    Documentation_Requirements: { title: "Documentation Requirements", color: "#fa8c16" },
    Glossary: { title: "Glossary", color: "#fa8c16" },
  });

  const isEditMode = !!editingProject;

  // Pre-populate form when editing
  useEffect(() => {
    if (editingProject && visible) {
      form.setFieldsValue({
        projectName: editingProject.project_name
      });
    } else if (!visible) {
      form.resetFields();
    }
  }, [editingProject, visible, form]);

  const handleCreateProject = async (values) => {
    try {
      await dispatch(createProject({
        projectName: values.projectName,
        template_document: {
          categories,
          sections: template
        },
        mvpVisiontemplate: mvpVisiontemplate
      })).unwrap();
      message.success("Project created successfully!");
      form.resetFields();
      onSuccess?.();
    } catch (error) {
      message.error("Failed to create project: " + error);
    }
  };

  const handleUpdateProject = async (values) => {

    try {
      await onUpdate(editingProject.id, values.projectName);
      form.resetFields();
      onSuccess?.();
    } catch (error) {
      message.error("Failed to update project: " + error);
    }
  };

  const handleSubmit = (values) => {
    if (isEditMode) {
      handleUpdateProject(values);
    } else {
      handleCreateProject(values);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel?.();
  };

  return (
    <>
      <Modal
        title={
          <Space className="text-lg">
            {isEditMode ? (
              <>
                <EditOutlined className="text-blue-500" />
                <span>Edit Project</span>
              </>
            ) : (
              <>
                <PlusOutlined className="text-blue-500" />
                <span>Create New Project</span>
              </>
            )}
          </Space>
        }
        open={visible}
        onCancel={handleCancel}
        footer={null}
        destroyOnClose
        width={500}
        className="create-project-modal"
        styles={{
          header: {
            borderBottom: '1px solid #f0f0f0',
            marginBottom: '20px',
            paddingBottom: '16px'
          }
        }}
      >
        <div className="py-2">
          <Form
            form={form}
            onFinish={handleSubmit}
            layout="vertical"
            size="large"
          >
            <Form.Item
              label={
                <span className="text-sm font-medium text-gray-700">
                  Project Name
                </span>
              }
              name="projectName"
              rules={[
                {
                  required: true,
                  message: "Please enter a project name"
                },
                {
                  min: 2,
                  message: "Project name must be at least 2 characters"
                },
                {
                  max: 50,
                  message: "Project name cannot exceed 50 characters"
                }
              ]}
            >
              <Input
                placeholder="Enter your project name"
                prefix={<ProjectOutlined className="text-gray-400" />}
                className="rounded-md"
                autoFocus
              />
            </Form.Item>

            <div className="text-center mt-6">
              <Space size="middle">
                <Button
                  size="large"
                  onClick={handleCancel}
                  className="min-w-20 rounded-md"
                >
                  Cancel
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  loading={loading}
                  icon={isEditMode ? <EditOutlined /> : <PlusOutlined />}
                  className="min-w-32 bg-blue-500 hover:bg-blue-600 border-none rounded-md"
                >
                  {isEditMode ? 'Update Project' : 'Create Project'}
                </Button>
              </Space>
            </div>
          </Form>

          {/* Help Text */}
          <div className="mt-6 p-4 bg-blue-50 rounded-md border border-blue-200">
            <div className="flex items-start">
              <ProjectOutlined className="text-blue-500 mt-1 mr-2 flex-shrink-0" />
              <div>
                <p className="text-sm text-blue-800 font-medium mb-1">
                  {isEditMode ? 'Editing Project' : 'Getting Started'}
                </p>
                <p className="text-xs text-blue-600 leading-relaxed">
                  {isEditMode
                    ? 'Update your project name. This will change how your project appears throughout the application.'
                    : 'Create a project to organize meetings, generated documents, and MCP connector settings.'
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default CreateProjectModal;