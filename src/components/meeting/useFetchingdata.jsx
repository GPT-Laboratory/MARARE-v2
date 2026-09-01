/**
 * Custom hook — fetches meeting-related data on mount.
 * File: src/components/meeting/useFetchingdata.jsx
 */
import {useEffect, useState} from 'react'
import supabase from '../../services/supabase/supabaseclient';

export function useFetchingdata() {
    const [usersName, setUsersName] = useState({});
    const [error, seterror] = useState();
    useEffect(() => {
      const fetchUser = async () => {
        try {
          const { data, error } = await supabase
            .from("users")
            
          console.log("data", data);
          if (error) {
            console.log("Error occured in setting data", error);
          }
  
          const namesmap = data.reduce((acc, user) => {
            acc[user.id] = user.name;
            return acc;
          }, {});
  
          setUsersName(namesmap);
        } catch (error) {
        seterror(error)
          console.error("Error occured while fetching username and id", error);
        }
      };
      fetchUser();
    }, []);
    console.log("usernames array", usersName);
    return { usersName, error };
}

