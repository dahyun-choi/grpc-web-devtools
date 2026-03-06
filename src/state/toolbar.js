// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";

const toolbarSlice = createSlice({
  name: 'toolbar',
  initialState: {
    filterIsOpen: true,
    filterIsEnabled: false,
    filterValue: "",
    globalSearchValue: "",
    settingsOpen: false,
  },
  reducers: {
    toggleFilter(state) {
      state.filterIsOpen = !state.filterIsOpen;
    },
    setFilterValue(state, action) {
      const { payload } = action;
      state.filterValue = payload;
      state.filterIsEnabled = !!(state.filterValue && state.filterValue.length > 0);
    },
    setGlobalSearchValue(state, action) {
      const { payload } = action;
      state.globalSearchValue = payload;
    },
    setSettingsOpen(state, action) {
      state.settingsOpen = action.payload;
    },
  },

});

const { actions, reducer } = toolbarSlice;
export const { toggleFilter, setFilterValue, setGlobalSearchValue, setSettingsOpen } = actions;

export default reducer
