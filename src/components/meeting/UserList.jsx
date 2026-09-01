/**
 * List of connected participants in the meeting room.
 * File: src/components/meeting/UserList.jsx
 */
import React, { useContext } from 'react';
import { Context } from '../ContextAzure';

const UserList = () => {
  const { users } = useContext(Context);

  return (
    <div>
      <h3>Connected Users:</h3>
      <ul>
        {users.length > 0 && users.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default UserList;
