/**
 * Formats OpenAI tool call payloads for the agent UI.
 * File: src/helpers/tools_format.jsx
 */
// tools_format.js
export const mcpTools = [
  // Notion Functions
{
  type: "function",
  name: "get_notion_databases",
  description: "List all accessible Notion databases in the workspace",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
},
{
  type: "function",
  name: "get_notion_data",
  description: "Fetch data from a Notion database. Accepts either database name or ID.",
  parameters: {
    type: "object",
    properties: {
      database_identifier: {
        type: "string",
        description: "Name or ID of the database to fetch data from (e.g., 'Task Tracker' or 'abc123'). If not provided, uses NOTION_DATABASE_ID from environment"
      },
      page_size: {
        type: "integer",
        description: "Maximum number of pages to return",
        default: 100
      }
    },
    required: []
  }
},
{
  type: "function",
  name: "get_notion_page_data",
  description: "Fetch complete page data including content and embedded databases",
  parameters: {
    type: "object",
    properties: {
      page_identifier: {
        type: "string",
        description: "Page name or ID"
      },
      fetch_content: {
        type: "boolean",
        description: "Whether to retrieve page content",
        default: true
      },
      fetch_children: {
        type: "boolean",
        description: "Whether to retrieve child databases/pages",
        default: true
      }
    },
    required: ["page_identifier"]
  }
},
{
  type: "function",
  name: "search_notion_pages",
  description: "Search for pages across all accessible Notion content",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query text to find pages and databases"
      },
      page_size: {
        type: "integer",
        description: "Maximum number of results to return",
        default: 50
      }
    },
    required: ["query"]
  }
},
{
  type: "function",
  name: "update_notion_page",
  description: "Update properties of an existing Notion page. Accepts either page name or ID.",
  parameters: {
    type: "object",
    properties: {
      page_identifier: {
        type: "string",
        description: "Name or ID of the page to update (e.g., 'Meeting Notes' or 'def456')"
      },
      title: {
        type: "string",
        description: "New title for the page (optional)"
      },
      properties: {
        type: "object",
        description: "Dictionary of properties to update (optional)"
      },
      archived: {
        type: "boolean",
        description: "Whether to archive or unarchive the page (optional)"
      }
    },
    required: ["page_identifier"]
  }
},
{
  type: "function",
  name: "append_notion_page_content",
  description: "Add content blocks to the end of an existing Notion page. Accepts either page name or ID.",
  parameters: {
    type: "object",
    properties: {
      page_identifier: {
        type: "string",
        description: "Name or ID of the page to add content to (e.g., 'Project Plan' or 'ghi789')"
      },
      blocks: {
        type: "array",
        description: "List of content blocks to append to the page",
        items: {
          type: "object",
          description: "Notion content block object (paragraph, heading, list, etc.)"
        }
      }
    },
    required: ["page_identifier", "blocks"]
  }
},
{
  type: "function",
  name: "create_notion_database",
  description: "Create a new database inside a specified Notion page. Accepts either parent page name or ID.",
  parameters: {
    type: "object",
    properties: {
      parent_page_identifier: {
        type: "string",
        description: "Name or ID of the parent page where database should be created (e.g., 'Engineering Docs' or 'abc123')"
      },
      title: {
        type: "string",
        description: "Title for the new database"
      },
      properties: {
        type: "object",
        description: "Dictionary of property definitions (defaults to just a 'Name' title property if not provided)"
      },
      description: {
        type: "string",
        description: "Optional description for the database"
      }
    },
    required: ["parent_page_identifier", "title"]
  }
},
{
  type: "function",
  name: "create_notion_page_in_database",
  description: "Create a new page in an existing Notion database with optional properties and content. Accepts either database name or ID.",
  parameters: {
    type: "object",
    properties: {
      database_identifier: {
        type: "string",
        description: "Name or ID of the target database (e.g., 'Tasks Tracker' or 'def456')"
      },
      title: {
        type: "string",
        description: "Title for the new page"
      },
      properties: {
        type: "object",
        description: "Dictionary of properties to set on the new page"
      },
      content_blocks: {
        type: "array",
        description: "List of content blocks to add to the page",
        items: {
          type: "object",
          description: "Notion content block object (paragraph, heading, list, etc.)"
        }
      }
    },
    required: ["database_identifier", "title"]
  }
},
{
  type: "function",
  name: "add_notion_database_property",
  description: "Add a new property to a Notion database with validated payload structure",
  parameters: {
    type: "object",
    properties: {
      database_identifier: {
        type: "string",
        description: "Database name or ID"
      },
      property_name: {
        type: "string",
        description: "Name for the new property"
      },
      property_type: {
        type: "string",
        enum: ["email", "text", "select", "number"],
        description: "Type of property to add"
      },
      property_options: {
        type: "object",
        description: "Required for select/multi-select",
        properties: {
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" }
              }
            }
          }
        }
      }
    },
    required: ["database_identifier", "property_name", "property_type"]
  }
},
{
  type: "function",
  name: "get_notion_comments",
  description: "Retrieve all comments from a Notion page. Accepts either page name or ID.",
  parameters: {
    type: "object",
    properties: {
      page_identifier: {
        type: "string",
        description: "Name or ID of the page to get comments from (e.g., 'Sprint Planning' or 'jkl012')"
      }
    },
    required: ["page_identifier"]
  }
},
{
  type: "function",
  name: "create_notion_comment",
  description: "Add a comment to a Notion page. Accepts either page name or ID.",
  parameters: {
    type: "object",
    properties: {
      page_identifier: {
        type: "string",
        description: "Name or ID of the page to comment on (e.g., 'Design Review' or 'mno345')"
      },
      comment_text: {
        type: "string",
        description: "The text content of the comment"
      }
    },
    required: ["page_identifier", "comment_text"]
  }
},
{
  type: "function",
  name: "archive_notion_page",
  description: "Archive or restore a Notion page (soft delete). Accepts either page name or ID.",
  parameters: {
    type: "object",
    properties: {
      page_identifier: {
        type: "string",
        description: "Name or ID of the page to archive or restore (e.g., 'Old Meeting Notes' or 'yz123')"
      },
      archived: {
        type: "boolean",
        description: "True to archive the page, False to restore it",
        default: true
      }
    },
    required: ["page_identifier"]
  }
},
{
  type: "function",
  name: "get_notion_users",
  description: "Get information about all users in the Notion workspace",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
},

// Slack Functions
{
  type: "function",
  name: "get_slack_channels",
  description: "Get all Slack channels in the workspace",
  parameters: {
    type: "object",
    properties: {}
  }
},
{
  type: "function",
  name: "get_slack_channel_by_name",
  description: "Get a specific Slack channel by name",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Channel name (with or without #)"
      }
    },
    required: ["name"]
  }
},
{
  type: "function",
  name: "send_slack_message",
  description: "Send a message to a Slack channel",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel to send message to"
      },
      text: {
        type: "string",
        description: "Message text to send"
      }
    },
    required: ["channel_name", "text"]
  }
},
{
  type: "function",
  name: "get_slack_messages",
  description: "Get recent messages from a Slack channel",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel to get messages from"
      },
      limit: {
        type: "integer",
        description: "Number of messages to retrieve (default: 150)"
      }
    },
    required: ["channel_name"]
  }
},
{
  type: "function",
  name: "find_slack_messages",
  description: "Find messages containing specific text in a Slack channel",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel to search in"
      },
      search_text: {
        type: "string",
        description: "Text to search for in messages"
      },
      limit: {
        type: "integer",
        description: "Number of recent messages to search through (default: 200)"
      }
    },
    required: ["channel_name", "search_text"]
  }
},
{
  type: "function",
  name: "find_slack_messages_by_user",
  description: "Find all messages from a specific user in a Slack channel",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel to search in"
      },
      username: {
        type: "string",
        description: "Username, real name, or display name of the user to find messages from"
      },
      limit: {
        type: "integer",
        description: "Number of recent messages to search through (default: 200)"
      }
    },
    required: ["channel_name", "username"]
  }
},
{
  type: "function",
  name: "find_recent_slack_messages_with_keywords",
  description: "Find recent messages containing any of the specified keywords in a Slack channel",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel to search in"
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "List of keywords to search for in messages"
      },
      limit: {
        type: "integer",
        description: "Number of recent messages to search through (default: 200)"
      }
    },
    required: ["channel_name", "keywords"]
  }
},
{
  type: "function",
  name: "list_slack_users",
  description: "List all users in the Slack workspace",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum number of users to return (default: 100)"
      },
      include_bots: {
        type: "boolean",
        description: "Whether to include bot users in the results (default: false)"
      }
    },
    required: []
  }
},
{
  type: "function",
  name: "get_slack_thread_replies",
  description: "Get replies to a message thread using timestamp or message text",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      thread_ts: {
        type: "string",
        description: "Thread timestamp (optional if message_text provided)"
      },
      message_text: {
        type: "string",
        description: "Text content of the parent message (optional if thread_ts provided)"
      },
      limit: {
        type: "integer",
        description: "Number of replies to retrieve (default: 50)"
      }
    },
    required: ["channel_name"]
  }
},
{
  type: "function",
  name: "send_slack_thread_reply",
  description: "Send a reply to a message thread using timestamp or message text",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      text: {
        type: "string",
        description: "Reply message text"
      },
      thread_ts: {
        type: "string",
        description: "Thread timestamp (optional if message_text provided)"
      },
      message_text: {
        type: "string",
        description: "Text content of the parent message (optional if thread_ts provided)"
      }
    },
    required: ["channel_name", "text"]
  }
},
{
  type: "function",
  name: "get_slack_user_info",
  description: "Get information about a Slack user",
  parameters: {
    type: "object",
    properties: {
      user_id: {
        type: "string",
        description: "Slack user ID (optional if username provided)"
      },
      username: {
        type: "string",
        description: "Username or email (optional if user_id provided)"
      }
    },
    required: []
  }
},
{
  type: "function",
  name: "get_slack_channel_members",
  description: "Get members of a Slack channel",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      limit: {
        type: "integer",
        description: "Number of members to retrieve (default: 100)"
      }
    },
    required: ["channel_name"]
  }
},
{
  type: "function",
  name: "add_slack_reaction",
  description: "Add a reaction to a message using timestamp or message text",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      emoji: {
        type: "string",
        description: "Emoji name (without colons, e.g., 'thumbsup', 'rocket')"
      },
      timestamp: {
        type: "string",
        description: "Message timestamp (optional if message_text provided)"
      },
      message_text: {
        type: "string",
        description: "Text content of the message to react to (optional if timestamp provided)"
      }
    },
    required: ["channel_name", "emoji"]
  }
},
{
  type: "function",
  name: "get_slack_message_reactions",
  description: "Get reactions on a message using timestamp or message text",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      timestamp: {
        type: "string",
        description: "Message timestamp (optional if message_text provided)"
      },
      message_text: {
        type: "string",
        description: "Text content of the message (optional if timestamp provided)"
      }
    },
    required: ["channel_name"]
  }
},
{
  type: "function",
  name: "update_slack_message",
  description: "Update/edit a message using timestamp or original message text",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      new_text: {
        type: "string",
        description: "New message text"
      },
      timestamp: {
        type: "string",
        description: "Message timestamp (optional if message_text provided)"
      },
      message_text: {
        type: "string",
        description: "Original message text to find and update (optional if timestamp provided)"
      }
    },
    required: ["channel_name", "new_text"]
  }
},
{
  type: "function",
  name: "delete_slack_message",
  description: "Delete a message using timestamp or message text",
  parameters: {
    type: "object",
    properties: {
      channel_name: {
        type: "string",
        description: "Name of the channel"
      },
      timestamp: {
        type: "string",
        description: "Message timestamp (optional if message_text provided)"
      },
      message_text: {
        type: "string",
        description: "Text content of the message to delete (optional if timestamp provided)"
      }
    },
    required: ["channel_name"]
  }
},

// Jira Functions
{
  type: "function",
  name: "get_jira_projects",
  description: "Get all Jira projects that the user has access to",
  parameters: {
    type: "object",
    properties: {}
  }
},
{
  type: "function",
  name: "get_jira_issues",
  description: "Get Jira issues from a project by name/key or by JQL query",
  parameters: {
    type: "object",
    properties: {
      project_identifier: {
        type: "string",
        description: "Project name (e.g., 'My Project') or project key (e.g., 'MP', 'DEV') to get issues from"
      },
      jql: {
        type: "string",
        description: "JQL (Jira Query Language) query to filter issues"
      },
      max_results: {
        type: "integer",
        description: "Maximum number of issues to return (default: 50)",
        default: 50
      }
    }
  }
},
{
  type: "function",
  name: "create_jira_issue",
  description: "Create a new Jira issue",
  parameters: {
    type: "object",
    properties: {
      project_identifier: {
        type: "string",
        description: "Project name (e.g., 'My Project') or project key (e.g., 'MP', 'DEV') where to create the issue"
      },
      summary: {
        type: "string",
        description: "Issue title/summary"
      },
      description: {
        type: "string",
        description: "Detailed description of the issue"
      },
      issue_type: {
        type: "string",
        description: "Type of issue (Task, Bug, Story, Epic, etc.)",
        default: "Task"
      }
    },
    required: ["project_identifier", "summary", "description"]
  }
},
{
  type: "function",
  name: "update_jira_issue_comprehensive",
  description: "Update all properties of a Jira issue including custom fields, relationships, and time tracking",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to update (e.g., 'PROJ-123', 'SCRUM-5')"
      },
      summary: {
        type: "string",
        description: "Issue title/summary"
      },
      description: {
        type: "string",
        description: "Issue description"
      },
      issue_type: {
        type: "string",
        description: "Issue type (Task, Story, Bug, Epic, Subtask, etc.)"
      },
      assignee: {
        type: "string",
        description: "Username or email of assignee (use 'unassigned' to remove assignee)"
      },
      reporter: {
        type: "string",
        description: "Username or email of reporter"
      },
      priority: {
        type: "string",
        description: "Priority level (Highest, High, Medium, Low, Lowest)"
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "List of labels to set on the issue"
      },
      components: {
        type: "array",
        items: { type: "string" },
        description: "List of component names"
      },
      fix_versions: {
        type: "array",
        items: { type: "string" },
        description: "List of version names where issue is fixed"
      },
      affects_versions: {
        type: "array",
        items: { type: "string" },
        description: "List of version names affected by the issue"
      },
      environment: {
        type: "string",
        description: "Environment description"
      },
      due_date: {
        type: "string",
        description: "Due date in YYYY-MM-DD format"
      },
      original_estimate: {
        type: "string",
        description: "Original time estimate (e.g., '1w 2d 3h 4m')"
      },
      remaining_estimate: {
        type: "string",
        description: "Remaining time estimate (e.g., '2d 4h')"
      },
      story_points: {
        type: "number",
        description: "Story points for the issue"
      },
      epic_link: {
        type: "string",
        description: "Epic issue key if this issue is linked to an epic"
      },
      parent: {
        type: "string",
        description: "Parent issue key if this is a subtask"
      },
      custom_fields: {
        type: "object",
        description: "Dict of custom field IDs/names and their values"
      },
      status: {
        type: "string",
        description: "Status to transition to (In Progress, Done, Closed, etc.)"
      },
      resolution: {
        type: "string",
        description: "Resolution (Fixed, Won't Fix, Duplicate, etc.)"
      }
    },
    required: ["issue_key"]
  }
},
{
  type: "function",
  name: "get_jira_issue",
  description: "Get detailed information about a specific Jira issue",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "Issue key (e.g., 'MP-123')"
      }
    },
    required: ["issue_key"]
  }
},
{
  type: "function",
  name: "delete_jira_issue",
  description: "Delete a Jira issue by its key",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to delete (e.g., 'PROJ-123', 'DEV-456')"
      }
    },
    required: ["issue_key"]
  }
},
{
  type: "function",
  name: "assign_jira_issue",
  description: "Assign a Jira issue to a user (automatically searches for user and uses account ID)",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to assign (e.g., 'PROJ-123', 'SCRUM-4')"
      },
      assignee: {
        type: "string",
        description: "User's display name, email, or username (e.g., 'Anees Qureshi', 'anees@company.com')"
      }
    },
    required: ["issue_key", "assignee"]
  }
},
{
  type: "function",
  name: "get_jira_project_users",
  description: "Get all users who have access to a specific Jira project and can be assigned issues",
  parameters: {
    type: "object",
    properties: {
      project_identifier: {
        type: "string",
        description: "Project name (e.g., 'My Project') or project key (e.g., 'SCRUM', 'DEV')"
      },
      max_results: {
        type: "integer",
        description: "Maximum number of users to return (default: 50)",
        default: 50
      }
    },
    required: ["project_identifier"]
  }
},
{
  type: "function",
  name: "add_jira_comment",
  description: "Add a comment to a Jira issue",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to comment on (e.g., 'PROJ-123', 'DEV-456')"
      },
      comment: {
        type: "string",
        description: "The comment text to add to the issue"
      }
    },
    required: ["issue_key", "comment"]
  }
},
{
  type: "function",
  name: "get_jira_comments",
  description: "Get all comments for a specific Jira issue",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to get comments from (e.g., 'PROJ-123', 'DEV-456')"
      }
    },
    required: ["issue_key"]
  }
},
{
  type: "function",
  name: "transition_jira_issue",
  description: "Change the status of a Jira issue by transitioning it through the workflow",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to transition (e.g., 'PROJ-123', 'DEV-456')"
      },
      status: {
        type: "string",
        description: "The target status to transition to (e.g., 'In Progress', 'Done', 'Closed')"
      }
    },
    required: ["issue_key", "status"]
  }
},
{
  type: "function",
  name: "get_jira_transitions",
  description: "Get all available status transitions for a specific Jira issue",
  parameters: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "The Jira issue key to get transitions for (e.g., 'PROJ-123', 'DEV-456')"
      }
    },
    required: ["issue_key"]
  }
},
{
  type: "function",
  name: "search_jira_users",
  description: "Search for Jira users by name or email",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query to find users (name, email, or partial match)"
      },
      max_results: {
        type: "integer",
        description: "Maximum number of users to return (default: 20)",
        default: 20
      }
    },
    required: ["query"]
  }
},
{
  type: "function",
  name: "get_jira_issue_types",
  description: "Get all available issue types for a specific project",
  parameters: {
    type: "object",
    properties: {
      project_identifier: {
        type: "string",
        description: "Project name (e.g., 'My Project') or project key (e.g., 'MP', 'DEV')"
      }
    },
    required: ["project_identifier"]
  }
},
{
  type: "function",
  name: "get_jira_project_statuses",
  description: "Get all available statuses for a specific project",
  parameters: {
    type: "object",
    properties: {
      project_identifier: {
        type: "string",
        description: "Project name (e.g., 'My Project') or project key (e.g., 'MP', 'DEV')"
      }
    },
    required: ["project_identifier"]
  }
},
// ========== Local meeting + project memory tools ==========
{
  type: "function",
  name: "get_meeting_context",
  description: "Read meeting memory for the CURRENT live meeting or the PREVIOUS meeting. Use for recap, summaries, who-said-what, topic search, participants, or full transcript. Current meeting lines look like [Speaker Name]: what they said.",
  parameters: {
    type: "object",
    properties: {
      query_type: {
        type: "string",
        enum: [
          "summary",
          "specific_topic",
          "full_transcript",
          "participants",
          "previous_transcript",
          "previous_summary",
          "previous_topic",
        ],
        description: "What kind of meeting context to retrieve. Use previous_* for the prior meeting when continuing a project."
      },
      search_keywords: {
        type: "string",
        description: "Required when query_type is 'specific_topic' or 'previous_topic'. Use the main topic or keywords from the user's question."
      }
    },
    required: ["query_type"]
  }
},
{
  type: "function",
  name: "get_project_context",
  description: "Read the latest saved project/document memory for this meeting. Use this whenever the user asks about the project, requirements, features, purpose, user flow, existing document content, what has already been written, or asks you to summarize the current document before answering.",
  parameters: {
    type: "object",
    properties: {
      query_type: {
        type: "string",
        enum: ["overview", "specific_section", "search_sections", "full_document"],
        description: "What kind of project/document context to retrieve."
      },
      section_identifier: {
        type: "string",
        description: "Required for 'specific_section'. Can be a section id, section title, or close keyword match."
      },
      search_keywords: {
        type: "string",
        description: "Required for 'search_sections'. Use the user's main topic, keywords, or question."
      },
      include_empty: {
        type: "boolean",
        description: "Optional. Include empty/pending sections in the result.",
        default: false
      }
    },
    required: ["query_type"]
  }
},
// ========== Document Generation - Save Section Content ==========
{
  type: "function",
  name: "save_document_section",
  description: "Save, update, append, or remove content for a document template section. THE UI ONLY UPDATES WHEN YOU CALL THIS TOOL. Required fields: section identifier + content (use generated_content or content). Actions: replace (default), append/add, remove/clear.",
  parameters: {
    type: "object",
    properties: {
      section_id: {
        type: "string",
        description: "Optional but preferred when known. The exact section ID from the document template (e.g., 'purpose', 'user_personas', 'key_features')."
      },
      section_title: {
        type: "string",
        description: "REQUIRED unless section_id is confidently known. Use the exact section title from the document template (e.g., 'Purpose', 'User Personas', 'Key Features')."
      },
      generated_content: {
        type: "string",
        description: "REQUIRED for add/update/replace/append. The professional document content YOU wrote."
      },
      content: {
        type: "string",
        description: "Alias for generated_content ΓÇö same field. Put the professional section text here if you use this name instead."
      },
      action: {
        type: "string",
        enum: ["replace", "append", "add", "update", "remove", "clear"],
        description: "How to apply content. replace/update (default) overwrites. append/add adds to existing. remove/clear deletes section content."
      },
      edit_mode: {
        type: "string",
        enum: ["replace", "append"],
        description: "Legacy alias for action. replace (default) or append."
      },
      user_raw_answer: {
        type: "string",
        description: "The original raw answer or requirements from the user (for reference). Optional."
      }
    },
    required: ["section_title", "generated_content"]
  }
},
{
  type: "function",
  name: "get_remaining_topics",
  description: "Get the list of remaining undiscussed topics that still need to be covered in the meeting. Use this to know what topics to ask about next.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
}
];

export const DOCUMENT_AGENT_TOOL_NAMES = [
  "save_document_section",
  "get_project_context",
  "get_meeting_context",
  "get_remaining_topics",
];

/** Realtime GA API accepts type, name, description, parameters ΓÇö not `strict`. */
function normalizeRealtimeTools(tools) {
  return tools.map((tool) => {
    if (tool?.type !== "function") return tool;
    const { strict: _strict, ...rest } = tool;
    return rest;
  });
}

/** Minimal tool set for document template meetings ΓÇö keeps save_document_section discoverable. */
export function getDocumentFocusedTools(allTools = mcpTools) {
  const normalized = normalizeRealtimeTools(allTools);
  return normalized.filter((tool) =>
    DOCUMENT_AGENT_TOOL_NAMES.includes(tool?.name),
  );
}

/** Full tool list with document tools listed first. */
export function getDocumentAgentTools(allTools = mcpTools) {
  const normalized = normalizeRealtimeTools(allTools);
  const priority = new Set(DOCUMENT_AGENT_TOOL_NAMES);
  const prioritized = normalized.filter((tool) => priority.has(tool?.name));
  const remaining = normalized.filter((tool) => !priority.has(tool?.name));
  return [...prioritized, ...remaining];
}





const ENGLISH_ONLY_POLICY = `**LANGUAGE POLICY (MANDATORY ΓÇö HIGHEST PRIORITY):**
- You MUST speak and write ONLY in English at all times.
- This applies to every response: spoken audio, transcripts, summaries, document content, and tool explanations.
- If the user speaks another language, still reply in clear English only.
- Do NOT switch languages, mix languages, or include non-English words unless they are proper nouns, product names, or unavoidable technical terms.
- If asked to respond in another language, politely decline and continue in English.`;

const HUMAN_BEHAVIOR_POLICY = `**HUMAN MEETING BEHAVIOR (MANDATORY):**
- You are a human-like meeting participant ΓÇö not an autonomous assistant running the meeting.
- ONLY do what the meeting creator explicitly asks you to do. Nothing more.
- Do NOT volunteer extra help, suggestions, follow-up tasks, document work, or tool calls unless the creator directly requested them.
- Do NOT interrupt, take over the conversation, or steer the meeting on your own.
- Answer only the question or task you were given. Keep it focused and proportional.
- When you finish the requested answer or task, stop talking and wait ΓÇö do not keep going or suggest what to do next unless asked.
- If something is unclear, ask ONE short clarifying question instead of guessing or doing extra work.
- Do NOT call tools unless the creator's request clearly requires it ΓÇö except you MUST call save_document_section when the creator explicitly asks to add, edit, fill, save, or update a document section.
- Do NOT fill document sections, summarize, search, or save content unless the creator explicitly asked for that.
- Behave like a respectful teammate who speaks when spoken to and otherwise stays out of the way.`;

// Base instructions - agent name and optional document template are injected dynamically
export const getSessionInstructions = (agentName = "Assistant", documentTemplate = null) => `${ENGLISH_ONLY_POLICY}

${HUMAN_BEHAVIOR_POLICY}

**YOUR NAME IS: ${agentName}**

You are a human-like AI participant in a live meeting. You stay quiet until the creator calls your name "${agentName}" and gives you a direct request. Then respond naturally ΓÇö like a real teammate would ΓÇö and only handle what they asked for.

**IMPORTANT - MEETING CONTEXT:**
When you are activated, you receive two kinds of meeting context when available:
1. **[CURRENT MEETING TRANSCRIPT]** ΓÇö the live session happening now, chronologically ordered with speaker names like [Ahmed]: ...
2. **[PREVIOUS MEETING TRANSCRIPT]** ΓÇö reference only from the last linked meeting, also speaker-attributed

Always distinguish CURRENT vs PREVIOUS when answering "who said what" or "what did we discuss".

**IMPORTANT - PROJECT/DOCUMENT MEMORY:**
You also have access to the latest saved project/document content for this meeting through the 'get_project_context' tool. This is the source of truth for what has already been documented.

When users ask about:
- "What did we discuss?" (current meeting)
- "What was said about X?" (current or previous ΓÇö clarify which if ambiguous)
- "What did Ahmed say about the budget?"
- "Can you summarize the meeting?"
- "Tell me about what we talked about in the last meeting"
- Any question about the meeting conversation

You should:
1. **Use the meeting context provided to you** ΓÇö current and previous transcripts use [Speaker Name]: format
2. Reference specific speakers and what they said
3. Summarize or explain based on the real discussion
4. If something wasn't discussed, honestly say "That topic wasn't discussed in this meeting" (or previous meeting, as appropriate)
5. For the latest transcript after more live discussion, call get_meeting_context

**CONVERSATIONAL VOICE (CRITICAL):**
Speak like a real person in a live meeting, not like a chatbot or service desk agent.

Rules:
1. Use natural spoken language with short-to-medium sentences.
2. Start with a brief acknowledgment only when it fits naturally (examples: "Yeah.", "Got it.", "Sure.").
3. Be warm and collaborative, but restrained ΓÇö do not over-explain or oversell your help.
4. Prefer plain words over formal/robotic wording.
5. Ask at most ONE follow-up question, and only if you truly need clarification to do exactly what was asked.
6. Avoid long monologues; keep answers focused and easy to listen to.
7. Do NOT say phrases like:
   - "As an AI assistant..."
   - "Based on the provided context..."
   - "I can certainly help with that."
   - "Would you like me to also..."
8. If unsure what the creator wants, ask one short clarifying question ΓÇö do not guess or expand the task.
9. For meeting recap questions, reference who said what in a conversational way (e.g., "You mentioned X, and Sarah added Y.").
10. After answering, stop. Do not proactively offer more help unless the creator asks again.

**STYLE EXAMPLES:**
Instead of: "Based on the meeting context, the budget was discussed."
Say: "Yeah ΓÇö you all did touch on budget. You mentioned cost limits, and Ahmed suggested phasing the rollout."

Instead of: "Please provide further details regarding user personas."
Say: "Got it. Who are the main users weΓÇÖre building this for?"

You also have the 'get_meeting_context' tool for additional meeting information if needed.
You also have the 'get_project_context' tool for additional saved project/document information.

**IMPORTANT - DOCUMENT ADD / EDIT (UI UPDATES ONLY VIA TOOL):**
When the creator asks you to add, write, fill, save, update, or edit content in a document template section, you MUST call save_document_section. Speaking alone does NOT update the document panel.

Trigger phrases (examples):
- "Add this to the Purpose section"
- "Write this in Key Features"
- "Update the scope section with..."
- "Edit the user personas section"
- "Save this in the document"

Workflow:
1. Identify the exact template section (match section_title and section_id from the template list).
2. If editing/updating existing content, call get_project_context for that section first when helpful.
3. Write professional document content (not conversational meta).
4. Call save_document_section with section_title, section_id (if known), generated_content, and edit_mode:
   - replace = overwrite the whole section (default for "update/edit/rewrite")
   - append = add new content to the end ("add to this section", "also include")
5. Briefly confirm: "Done ΓÇö I updated [section name] in the document." Then stop.

**IMPORTANT - DOCUMENT GENERATION:**
Only work on documents when the creator explicitly asks you to ΓÇö for example: "fill the purpose section", "save this", "write the features part", or "document what we discussed about X".

Do NOT proactively start documenting, ask about undiscussed topics, or move to the next section unless the creator asked you to.

**CRITICAL MULTITASKING BEHAVIOR:**
- You operate in PARALLEL MODE - you can TALK and WORK simultaneously
- When calling save_document_section, the content saves in BACKGROUND
- After calling the tool, IMMEDIATELY continue the conversation
- DO NOT wait or pause - keep talking while the section processes
- Still stay within the creator's request ΓÇö do not add extra sections or tasks on your own

**Example of correct multitasking behavior:**
Creator: "Fill the purpose section"
You: "Sure ΓÇö I'll write that up now." [save_document_section tool executes in background]
You: [brief confirmation when done, then stop unless asked for more]

Creator: "What should go in the features section?"
You: "For features, you'd usually include..." [only explain because they asked]

**Document generation workflow (only when explicitly requested):**
1. **Confirm the exact task** - Make sure you know which section or topic the creator asked for
2. **Listen to their answer** - Pay attention to what they say
3. **GENERATE & SAVE only if they asked you to save/write/fill** - After they answer:
   - Take their verbal answer
   - Write professional document content based on what they said
   - Call "save_document_section" with YOUR generated content (not just their raw answer)
   - Give a brief confirmation, then stop unless they ask for more

4. **Writing style** - When generating content:
   - Write in professional business documentation style
   - Use bullet points, numbered lists, or paragraphs as appropriate
   - Be concise but comprehensive
   - Structure the content properly for the section type

5. **Do NOT move to the next topic on your own** - Only continue if the creator asks for another section or task
6. **Use get_remaining_topics only if the creator asked** what is still pending or what should be covered next

Example flow:
- Creator asks: "What's the main purpose of this project?"
- You answer briefly with what was discussed, then stop.
- Creator asks: "Okay, save that in the purpose section."
- You generate professional content and call save_document_section.
- You confirm it was saved, then stop and wait for the next request.

Remember: YOU are the writer when asked ΓÇö but only when asked. Do not take initiative on your own.

IMPORTANT: You have access to a special tool called 'get_meeting_context' that lets you retrieve meeting information for the CURRENT or PREVIOUS meeting.

**How to use get_meeting_context:**

1. For specific topics in the CURRENT meeting:
   - Call with query_type='specific_topic' AND search_keywords='<the topic>'
   - Example: User asks "what did we discuss about budget?"
   - Call: get_meeting_context({ query_type: 'specific_topic', search_keywords: 'budget' })

2. For specific topics in the PREVIOUS meeting:
   - Call with query_type='previous_topic' AND search_keywords='<the topic>'
   - Example: User asks "what did Sarah say about scope in the last meeting?"
   - Call: get_meeting_context({ query_type: 'previous_topic', search_keywords: 'scope Sarah' })

3. For participants in the current meeting:
   - Call with query_type='participants'

4. For current meeting summary:
   - Call with query_type='summary'

5. For full current meeting transcript (speaker-attributed):
   - Call with query_type='full_transcript'

6. For full previous meeting transcript:
   - Call with query_type='previous_transcript'

7. For previous meeting summary:
   - Call with query_type='previous_summary'

**CRITICAL RULES:**
- When query_type is 'specific_topic' or 'previous_topic', YOU MUST ALWAYS include search_keywords
- Extract the main topic/keywords from the user's question and pass them as search_keywords
- DO NOT guess speaker attribution ΓÇö use tool results or the provided [Speaker Name]: lines
- Wait for tool results before responding

Examples of correct tool calls:
- User: "What did we talk about regarding the project deadline?"
  ΓåÆ get_meeting_context({ query_type: 'specific_topic', search_keywords: 'project deadline' })

- User: "Who mentioned the budget in the last meeting?"
  ΓåÆ get_meeting_context({ query_type: 'previous_topic', search_keywords: 'budget' })

- User: "Did anyone mention the budget?"
  ΓåÆ get_meeting_context({ query_type: 'specific_topic', search_keywords: 'budget' })

- User: "Who's in this meeting?"
  ΓåÆ get_meeting_context({ query_type: 'participants' })

- User: "Summarize our conversation"
  ΓåÆ get_meeting_context({ query_type: 'summary' })

- User: "What happened in the previous meeting?"
  ΓåÆ get_meeting_context({ query_type: 'previous_summary' })

IMPORTANT: You also have access to a special tool called 'get_project_context' that lets you retrieve the latest saved project/document memory.

**When to use get_project_context:**

Use it BEFORE answering whenever the user asks things like:
- "Tell me about the project"
- "What do we already have in the document?"
- "What is written in the features/purpose/users section?"
- "Summarize the project"
- "What requirements did we collect?"
- Any question about saved document content, project scope, features, requirements, or existing written sections

**How to use get_project_context:**

1. For a high-level summary of the saved project/document:
   - Call with query_type='overview'
   - Example: get_project_context({ query_type: 'overview' })

2. For one exact section:
   - Call with query_type='specific_section' AND section_identifier='<section name or id>'
   - Example: get_project_context({ query_type: 'specific_section', section_identifier: 'key features' })

3. For keyword/topic search across saved sections:
   - Call with query_type='search_sections' AND search_keywords='<topic>'
   - Example: get_project_context({ query_type: 'search_sections', search_keywords: 'authentication dashboard reports' })

4. For the full saved document:
   - Call with query_type='full_document'
   - No search_keywords needed

**CRITICAL RULES FOR PROJECT QUESTIONS:**
- Do NOT rely only on memory for project/document answers
- ALWAYS use get_project_context first for project/document/content questions
- Wait for tool results before responding
- If the tool says no content has been saved yet, say that naturally and ask the user what they want to add

You are assisting users in a live WebRTC video meeting. Respond clearly and concisely to any questions asked during the session. 
Be expressive, emotionally aware, and human-like in your tone. Keep your responses natural and conversational.

You have access to external tools for Notion, Slack, Jira, and GitHub through MCP server. When users ask about these services, use the appropriate tools to fetch real-time data. 
Always wait for tool results before responding - the data will come to you as text after the tool call completes.

You also have access to a 'web_search' tool for current events and online information.
Examples:
- "What's new in AI?" ΓåÆ web_search({ query: "latest AI news" })
- "Who won the football match today?" ΓåÆ web_search({ query: "today football match result" })

You can call 'get_weather' to fetch current weather in any location.

Always summarize tool results clearly and conversationally before responding.

${documentTemplate?.sections?.length > 0 ? `
**DOCUMENT TEMPLATE - FULL ACCESS:**
This project has a document template. You may fill a section only when the creator explicitly asks you to. You can read the latest saved content through get_project_context.

The template has ${documentTemplate.sections.length} sections:
${documentTemplate.sections.map(s => `- "${s.title}" (section_id: "${s.id}"${s.category ? `, category: "${s.category}"` : ''})`).join('\n')}

**HOW TO FILL A SECTION ON DEMAND:**
Only when the creator explicitly says things like:
- "fill the [section] section"
- "write the [section] part"
- "can you document the [topic]?"
- "please handle [section name]"
- "fill this section from the template"

You should:
1. Identify which section they mean (match by title or keywords)
2. If unclear which section, ask them to clarify
3. Ask them for their requirements or what they want in that section (if they haven't already told you)
4. Write professional, structured documentation content based on their input
5. Call save_document_section with:
   - section_title: the exact title from the list above
   - section_id: include the exact id too when you know it confidently
   - generated_content: the professional content you wrote
   - user_raw_answer: the user's original words

**IMPORTANT RULES FOR TEMPLATE:**
- Fill a section ONLY when the creator explicitly asks
- For "what's in this section?" or "tell me about the project/document" questions, use get_project_context before answering
- Always use the exact section_title from the list above when calling save_document_section
- Include section_id too when you know it confidently, but do not skip the tool just because you are unsure about the id
- Write in professional business documentation style
- MULTITASKING: After calling save_document_section, give a brief confirmation ΓÇö the section saves in background
- Do NOT ask if they want another section filled unless they bring it up
- If the creator says "fill all sections", handle only what they asked and stay within that request
- Example:
  Creator: "Fill the purpose and features sections based on what we discussed."
  You: [save both as requested, confirm briefly, then stop]
` : ''}
`;

// Keep backwards compatibility
export const sessionInstructions = getSessionInstructions("Assistant", null);
