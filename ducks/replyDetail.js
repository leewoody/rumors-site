import { createDuck } from 'redux-duck';
import { fromJS } from 'immutable';
import NProgress from 'nprogress';
import { waitForAuth } from './auth';
import gql from '../util/gql';

const { defineType, createAction, createReducer } = createDuck('replyDetail');

// Action Types
//

const LOAD = defineType('LOAD');
const LOAD_AUTH = defineType('LOAD_AUTH');
const SET_STATE = defineType('SET_STATE');
const RESET = defineType('RESET');

// Action creators
//

const loadData = createAction(LOAD);
const setState = createAction(SET_STATE);

export const load = id => dispatch => {
  dispatch(setState({ key: 'isLoading', value: true }));
  return gql`
    query($id: String!) {
      GetReply(id: $id) {
        versions(limit: 1) {
          type
          text
          reference
          createdAt
        }
        replyConnections: articleReplies {
          id
          articleId
          article {
            id
            text
            replyCount
          }
          replyId
          user {
            name
          }
          feedbacks {
            score
          }
          status
          canUpdateStatus
          createdAt
        }
      }
    }
  `({ id }).then(resp => {
    dispatch(loadData(resp.getIn(['data', 'GetReply'])));
    dispatch(setState({ key: 'isLoading', value: false }));
  });
};

export const loadAuth = id => dispatch => {
  dispatch(setState({ key: 'isAuthLoading', value: true }));
  return waitForAuth
    .then(() =>
      gql`
        query($id: String!) {
          GetReply(id: $id) {
            replyConnections: articleReplies {
              id
              articleId
              replyId
              canUpdateStatus
            }
          }
        }
      `({ id })
    )
    .then(resp => {
      dispatch(createAction(LOAD_AUTH)(resp.getIn(['data', 'GetReply'])));
      dispatch(setState({ key: 'isAuthLoading', value: false }));
    });
};

export const updateArticleReplyStatus = (
  articleId,
  replyId,
  status
) => dispatch => {
  dispatch(setState({ key: 'isReplyLoading', value: true }));
  NProgress.start();
  return gql`
    mutation(
      $articleId: String!
      $replyId: String!
      $status: ArticleReplyStatusEnum!
    ) {
      UpdateArticleReplyStatus(
        articleId: $articleId
        replyId: $replyId
        status: $status
      ) {
        id
      }
    }
  `({ articleId, replyId, status }).then(() => {
    // FIXME:
    // Immediate load(replyId) will not get updated reply connection status.
    // Super wierd.
    //
    setTimeout(() => {
      NProgress.done();
      dispatch(load(replyId)).then(() => {
        dispatch(setState({ key: 'isReplyLoading', value: false }));
      });
    }, 1000);
  });
};

export const voteReply = (replyId, replyConnectionId, vote) => dispatch => {
  dispatch(setState({ key: 'isReplyLoading', value: true }));
  NProgress.start();
  return gql`
    mutation($replyConnectionId: String!, $vote: FeedbackVote!) {
      CreateOrUpdateReplyConnectionFeedback(
        replyConnectionId: $replyConnectionId
        vote: $vote
      ) {
        feedbackCount
      }
    }
  `({ replyConnectionId, vote }).then(() => {
    dispatch(load(replyId)).then(() => {
      dispatch(setState({ key: 'isReplyLoading', value: false }));
    });
    NProgress.done();
  });
};

export const reset = () => createAction(RESET);

// Reducer
//

const initialState = fromJS({
  state: { isLoading: false, isAuthLoading: false, isReplyLoading: false },
  data: {
    // data from server
    reply: null,
    originalReplyConnection: null,
  },
});

export default createReducer(
  {
    [SET_STATE]: (state, { payload: { key, value } }) =>
      state.setIn(['state', key], value),

    [LOAD]: (state, { payload }) => {
      const originalReplyConnection = payload
        .getIn(['replyConnections'])
        .sortBy(item => item.get('createdAt'))
        .first();
      return state
        .setIn(['data', 'reply'], payload)
        .setIn(
          ['data', 'originalReplyConnection'],
          originalReplyConnection.set('reply', payload)
        );
    },

    [LOAD_AUTH]: (state, { payload }) => {
      // Write LOAD_AUTH results to existing replyConnections
      //
      const idAuthMap = payload.get('replyConnections').reduce((agg, conn) => {
        agg[conn.get('id')] = conn;
        return agg;
      }, {});

      const updateConnection = conn => conn.merge(idAuthMap[conn.get('id')]);

      return state
        .updateIn(['data', 'reply', 'replyConnections'], replyConnections =>
          replyConnections.map(updateConnection)
        )
        .updateIn(['data', 'originalReplyConnection'], updateConnection);
    },

    [RESET]: state => state.set('data', initialState.get('data')),
  },
  initialState
);
