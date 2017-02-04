import AppCore                           from '../app-core';
import React                             from 'react';
import {User, Member, Chat, ChatMessage} from '../entities';
import fs                                from 'fs';
import ZentaoAPI                         from '../api';
import R                                 from '../../resource';
import ChatDao                           from './dao';
import Path                              from 'path';
import PKG                               from '../../package.json';
import Moment                            from 'moment';
import Modal                             from 'Components/modal';
import TextField                         from 'material-ui/TextField';

const Helper = global.Helper;

/**
 * Chat application handler
 */
class ChatApp extends AppCore {
    constructor(app) {
        super(app);

        // Store then actived chat window id
        this.activeChatWindow;

        // Handle application events
        app.on(R.event.app_socket_change, () => {
            this.socket.setHandler({
                chat: {
                    changename: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.name = msg.data.name;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    addmember: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                let serverChatMembers = new Chat(msg.data).members;
                                let newMembers = [];
                                serverChatMembers.forEach(x => {
                                    if(!chat.members.has(x)) {
                                        newMembers.push(x);
                                    }
                                });

                                if(newMembers.length) {
                                    chat.addMessage(new ChatMessage({
                                        type: 'broadcast',
                                        content: this.$app.lang.chat.someoneJoinChat.format(newMembers.map(x => this.$dao.members[x].displayName).join(', ')),
                                        cgid: chat.gid,
                                        date: new Date(),
                                        sender: this.user
                                    }));
                                }

                                chat.assign(msg.data);
                                chat.updateMembersSet(this.dao$);
                                this.dao.updateChats(chat);
                            } else {
                                chat = new Chat(msg.data);
                                chat.updateMembersSet(this.dao$);
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    getlist: msg => {
                        if(msg.isSuccess) {
                            let chats = Object.keys(msg.data).map(key => {
                                let chat = new Chat(msg.data[key]);
                                chat.updateMembersSet(this.$dao);
                                return chat;
                            });

                            this.dao.initChats(chats);
                        }
                    },
                    create: msg => {
                        if(msg.isSuccess) {
                            let chat = new Chat(msg.data);
                            chat.updateMembersSet(this.$dao);

                            this.dao.updateChats(chat);
                        }
                    },
                    message: msg => {
                        if(msg.isSuccess) {
                            let messages = msg.data;
                            if(!Array.isArray(messages)) {
                                if(messages.cgid && messages.content) {
                                    messages = [messages];
                                } else {
                                    messages = Object.keys(messages).map(x => messages[x]);
                                }
                            }

                            messages = messages.map(x => new ChatMessage(x));

                            if(messages && messages.length) {
                                this.dao.updateChatMessages(messages, this.user.id);
                            }
                        }
                    },
                    history: msg => {
                        if(msg.isSuccess) {
                            let messages = msg.data;
                            if(!Array.isArray(messages)) {
                                if(messages.cgid && messages.content) {
                                    messages = [messages];
                                } else {
                                    messages = Object.keys(messages).map(x => messages[x]);
                                }
                            }

                            messages = messages.map(x => new ChatMessage(x));

                            if(messages && messages.length) {
                                this.dao.updateChatMessages(messages, false, true);
                            }

                            let pager = msg.pager;
                            pager.isFetchOver = pager.pageID * pager.recPerPage >= pager.recTotal;
                            if(pager.continued && !pager.isFetchOver) {
                                this.getChatHistory(pager.gid, {
                                    recPerPage: pager.recPerPage, 
                                    pageID: pager.pageID + 1, 
                                    recTotal: pager.recTotal, 
                                    continued: true
                                });
                            }
                            this.$app.emit(R.event.chats_history, messages, pager);
                        }
                    },
                    star: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.star = msg.data.star;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    joinchat: msg => {
                        if(msg.isSuccess) {
                            if(!msg.data.join) {
                                this.dao.deleteChat(msg.data.gid);
                            }
                        }
                    },
                    hide: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.hide = msg.data.hide;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    changepublic: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.public = msg.data.public;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    getpubliclist: msg => {
                        let chats;
                        if(msg.isSuccess) {
                            chats = msg.data.map(x => {
                                let chat = new Chat(x);
                                chat.updateMembersSet(this.$dao);
                                return chat;
                            });
                        } else {
                            chats = [];
                        }
                        this.$app.emit(R.event.data_get_public_list, chats);
                    },
                }
            });
        });

        app.on(R.event.chats_notice, (data) => {
            let totalNoticeCount = 0;
            let chats = this.dao.getChats(x => {
                if(x.noticeCount && (!this.$app.isWindowOpen || !this.$app.isWindowsFocus || x.gid !== this.activeChatWindow)) {
                    totalNoticeCount += x.noticeCount;
                    this.lastNoticeChatGid = x.gid;
                } else {
                    x.noticeCount = 0;
                }
                return false;
            });
            this.totalNoticeCount = totalNoticeCount || false;
            this.$app.badgeLabel = this.totalNoticeCount;
            this.$app.trayTooltip = this.totalNoticeCount ? (this.$app.lang.chat.someNewMessages || '{0} 条新消息').format(this.totalNoticeCount) : false;
            if(this.totalNoticeCount && (!this.$app.isWindowOpen || !this.$app.isWindowsFocus)) {
                if(Helper.isWindowsOS) {
                    if(!this.$app.isWindowOpen) this.$app.flashTrayIcon(this.totalNoticeCount);
                    this.$app.requestAttention(1);
                }
                if(!this.$app.isWindowOpen) this.$app.playSound('message');
            }
        });

        app.on(R.event.ui_show_main_window, () => {
            if(Helper.isWindowsOS) this.$app.flashTrayIcon(false);
            if(this.totalNoticeCount && this.lastNoticeChatGid) {
                let chat = this.dao.getChat(this.lastNoticeChatGid, true, true);
                this.$app.changeUI({navbar: R.ui.navbar_chat, menu: ['chat', this.lastNoticeChatGid, chat]});
            }
        });

        app.on(R.event.ui_focus_main_window, () => {
            if(Helper.isWindowsOS) this.$app.flashTrayIcon(false);
            if(this.activeChatWindow) {
                let chat = this.dao.getChat(this.activeChatWindow, true, true);
                if(chat && chat.noticeCount) {
                    this.$app.changeUI({navbar: R.ui.navbar_chat, menu: ['chat', chat.gid, chat]});
                }
            }
        });

        app.on(R.event.user_login_finish, e => {
            if(e.result) {
                app.registerGlobalHotKey({
                    key: 'Ctrl+Alt+Z',
                    active: () => {
                        this.captureAndSendScreen();
                    }
                });
            }
        });
    }

    /**
     * Init dao object
     * @return {object}
     */
    initDao() {
        return new ChatDao(this);
    }

    /**
     * Create chat with with members
     * @param  {...[Member]} members
     * @return {void}
     */
    create(...members) {
        if(!members.find(member => member.id === this.user.id)) {
            members.push(this.user);
        }

        let chat = new Chat({
            membersSet: members,
            createdBy: this.user.account
        });

        let checkChat = this.dao.getChat(chat.gid);
        if(checkChat) chat = checkChat;
        else {
            this.dao.updateChats(chat);
            this.socket.send(this.socket.createSocketMessage({
                'method': 'create',
                'params': [chat.gid, chat.name || '', chat.type, chat.members, 0]
            }));
        }
        
        this.$app.changeUI({navbar: R.ui.navbar_chat, menu: ['chat', chat.gid]});
    }

    /**
     * Get all chats
     * @return {[type]} [description]
     */
    get all() {
        return this.dao ? this.dao.getChats() : null;
    }

    /**
     * Create chat action context menu
     * @param  {Chat} chat
     * @param  {Window} window
     * @return {gui.Menu}
     */
    createActionsContextMenu(chat, window) {
        let menu = [];
        if(chat.isOne2One) {
            menu.push({
                label: this.lang.user.viewProfile,
                click: () => {
                    this.$app.openProfile({member: chat.getTheOtherOne(this.user), inModal: true});
                }
            }, {
                type: 'separator'
            });
        }

        menu.push({
            label: chat.star ? this.lang.chat.removeStar : this.lang.chat.star,
            click: () => {
                this.toggleStar(chat);
            }
        }, {
            label: chat.hide ? this.lang.chat.pinnedInList : this.lang.chat.removeFromList,
            click: () => {
                this.toggleShow(chat);
            }
        });

        if(chat.canRename) {
            menu.push({
                label: this.lang.common.rename,
                click: () => {
                    this.renamePrompt(chat);
                }
            });
        }

        if(chat.canMakePublic(this.user)) {
            menu.push({
                label: chat.public ? this.lang.chat.cancelSetPublic : this.lang.chat.setPublic,
                click: () => {
                    this.togglePublic(chat);
                }
            });
        }

        if(chat.canExit) {
            menu.push({
                type: 'separator'
            },{
                label: this.lang.chat.exitChat,
                click: () => {
                    this.exitConfirm(chat);
                }
            });
        }

        return this.$app.createContextMenu(menu);
    }

    /**
     * Open a confirm window ask user to exit chat
     */
    exitConfirm(chat) {
        Modal.show({
            modal: true,
            closeButton: false,
            content: this.lang.chat.exitChatConfirm.format(chat.getDisplayName(this.$app)),
            width: 360,
            actions: [{type: 'cancel'}, {type: 'submit'}],
            onSubmit: () => {
                this.exit(chat);
            }
        });
    }

    /**
     * Open a prompt window for user rename a chat
     */
    renamePrompt(chat) {
        let newName = null;
        let content = <div>
            <p>{this.lang.chat.renameTheChat.format(chat.getDisplayName(this.$app))}</p>
            <TextField
              ref={(e) => setTimeout(() => {
                  e.focus();
              }, 400)}
              hintText={this.lang.chat.inputChatNewName}
              onChange={e => {newName = e.target.value}}
              defaultValue={chat.name}
              fullWidth={true}
            />
        </div>;
        Modal.show({
            modal: true,
            closeButton: false,
            content: content,
            width: 360,
            actions: [{type: 'cancel'}, {type: 'submit', label: this.lang.common.rename}],
            onSubmit: () => {
                if(Helper.isNotEmptyString(newName) && newName !== chat.name) {
                    this.rename(chat, newName);
                }
            }
        });
    }

    /**
     * Toggle chat
     * @param  {Chat} chat
     * @return {void}
     */
    toggleShow(chat) {
        this.socket.send(this.socket.createSocketMessage({
            'method': 'hide',
            'params': [chat.gid, !!!chat.hide]
        }));
    }

    /**
     * Toggle chat public status
     * @param  {Chat} chat
     * @return {void}
     */
    togglePublic(chat) {
        this.socket.send(this.socket.createSocketMessage({
            'method': 'changePublic',
            'params': [chat.gid, !!!chat.public]
        }));
    }

    /**
     * Get all public chats as list
     * @return {void}
     */
    getPublicList() {
        this.socket.send(this.socket.createSocketMessage({
            'method': 'getPublicList'
        }));
    }

    /**
     * Get chat history by options
     * @param  {Chat} chat
     * @param  {Object} options (optional)
     * @return {void}
     */
    getChatHistory(chat, options) {
        options = Object.assign({
            recPerPage: 20, 
            pageID: 1, 
            recTotal: 0, 
            continued: true
        }, options);
        let cgid = chat.gid || chat;
        this.socket.send(this.socket.createSocketMessage({
            'method': 'history',
            'params': [cgid, options.recPerPage, options.pageID, options.recTotal, options.continued]
        }));
    }

    /**
     * Send chat messages
     * @param  {[ChatMessage]} messages
     * @param  {Chat} chat
     * @return {void}
     */
    sendChatMessage(messages, chat) {
        if(!Array.isArray(messages)) messages = [messages];

        if(chat) chat.addMessage(...messages);
        this.dao.$dao.upsert(messages);
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'message',
            'params': {
                messages: messages.map(m => {return {gid: m.gid, cgid: m.cgid, type: m.type, contentType: m.contentType, content: m.content, date: "", user: m.user}})
            }
        }));
    }

    /**
     * Send chat message
     * @param  {ChatMessage} message
     * @return {void}
     */
    sendMessage(message) {
        let command = message.getCommand();
        if(command) {
            if(command.action === 'rename') {
                setTimeout(() => {
                    this.rename(this.dao.getChat(message.cgid), command.name);
                }, 500);
            } else if(command.action === 'version') {
                message.content = '```\n$$version = "' + `v${PKG.version}${PKG.distributeTime ? (' (' + Moment(PKG.distributeTime).format('YYYYMMDDHHmm') + ')') : null} ${DEBUG ? '[debug]' : ''}` + '";\n```';
            }
        }
        this.sendChatMessage(message);
    }

    /**
     * Rename a chat
     * @param  {Chat} chat
     * @param  {string} newName
     * @return {void}
     */
    rename(chat, newName) {
        if(chat && chat.canRename) {
            return this.socket.send(this.socket.createSocketMessage({
                'method': 'changeName',
                'params': [chat.gid, newName]
            }));
        }
    }

    /**
     * Capture screen image and send it
     * @param  {Chat} chat
     * @return {void}
     */
    captureAndSendScreen(chat) {
        if(!chat && this.activeChatWindow) {
            chat = this.dao.getChat(this.activeChatWindow);
        }

        if(!chat) return console.error('Select an chat before send screenshot.');

        this.$app.captureScreen(image => {
            if(image && image.path) {
                this.$app.emit(R.event.capture_screen, image, chat);
                // this.sendImageMessage(chat, image);
                this.$app.showAndFocusWindow();
            }
        });
    }

    /**
     * Upload image file and send message
     * @param  {ChatMessage} message
     * @param  {Chat} chat
     * @param  {function} reject
     * @return {void}
     */
    uploadMessageImage(message, chat, reject) {
        if(!chat) chat = this.dao.getChat(message.cgid);
        if(!chat) return false;

        message.imageContent = Object.assign(message.imageContent, {send: 0, id: null});
        let file = message.attachFile;
        if(!file) file = message.imageContent;
        if(!file.path) file.path = Path.join(this.$app.user.imagesPath, file.name);

        this.sendChatMessage(message, chat);
        this.$app.uploadFile(file, {gid: chat.gid}).then(f => {
            message.imageContent = Object.assign(message.imageContent, f, {send: true});
            this.sendChatMessage(message, chat);
        }).catch(err => {
            message.imageContent = Object.assign(message.imageContent, {send: false});
            this.sendChatMessage(message, chat);
            return reject && reject(err);
        });
    }

    /**
     * Send image with message
     * @param  {Chat} chat
     * @param  {File} file
     * @param  {function} reject
     * @return {void}
     */
    sendImageMessage(chat, file, reject) {
        console.info('sendImageMessage', chat, file, reject);
        if(!file.path) {
            if(DEBUG) console.error('Cannot send image message ', file, chat);
            return;
        }

        let message = new ChatMessage({
            sender: this.user,
            cgid: chat.gid,
            date: new Date(),
            contentType: 'image',
            attachFile: file,
            imageContent: {name: file.name, size: file.size, send: 0, type: file.type}
        });

        let imagesPath = this.user.imagesPath;
        if(!file.path.startsWith(imagesPath)) {
            let fileName = this.user.makeFileName(file.type ? file.type.replace('image/', '.') : '.png');
            let filePath = Path.join(imagesPath, fileName);
            Helper.copyFile(file.path, filePath).then(() => {
                file = Object.assign({}, file, {path: filePath, name: fileName});
                message.attachFile = file;
                message.imageContent = Object.assign(message.imageContent, {path: filePath, name: fileName});
                this.uploadMessageImage(message, chat, reject);
            }).catch(err => {
                message.imageContent = Object.assign(message.imageContent, {send: false});
                this.sendChatMessage(message, chat);
                return reject && reject(err);
            });
        } else {
            this.uploadMessageImage(message, chat, reject);
        }
    }

    /**
     * Upload file with message
     * @param  {ChatMessage} message
     * @param  {Chat} chat
     * @param  {function} reject
     * @return {void}
     */
    uploadMessageFile(message, chat, reject) {
        if(!chat) chat = this.dao.getChat(message.cgid);
        if(!chat) return false;
        let file = message.attachFile;
        if(!file) return false;

        message.fileContent = Object.assign(message.fileContent, {send: 0});
        message.date = new Date().getTime();
        this.$app.emit(R.event.data_change, {chats: [chat]});
        
        this.$app.uploadFile(file, {gid: message.cgid}).then(f => {
            message.fileContent = Object.assign(message.fileContent, {send: true, id: f.id});
            this.sendChatMessage(message, chat);
        }).catch(err => {
            message.fileContent = Object.assign(message.fileContent, {send: false});
            this.$app.emit(R.event.data_change, {chats: [chat]});
            return reject && reject(err);
        });
    }

    /**
     * Send file with message
     * @param  {Chat} chat
     * @param  {File} file
     * @param  {function} reject
     * @return {void}
     */
    sendFileMessage(chat, file, reject) {
        let message = new ChatMessage({
            sender: this.user,
            cgid: chat.gid,
            date: new Date(),
            contentType: 'file',
            attachFile: file,
            fileContent: {name: file.name, size: file.size, send: 0, type: file.type},
        });

        chat.addMessage(message);
        
        this.uploadMessageFile(message, chat, reject);
    }

    /**
     * Invite members to chat
     * @param  {Chat} chat
     * @param  {[Member]} members
     * @return {void}
     */
    inviteMembers(chat, members) {
        if(chat.canInvite) {
            if(!chat.isOne2One) {
                this.inviteMembersToChat(chat, members);
            } else {
                members.push(...chat.membersSet);
                this.create(...members);
            }
        }
    }

    /**
     * Invite members to chat
     * @param  {Chat} chat
     * @param  {[Members]} members
     * @return {void}
     */
    inviteMembersToChat(chat, members) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'addmember',
            'params': [chat.gid, members.map(x => x.id), true]
        }));
    }

    /**
     * Join a public chat
     * @param  {Chat} chat
     * @return {void}
     */
    joinChat(chat) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'joinchat',
            'params': [chat.gid, true]
        }));
    }

    /**
     * Request chats list by send socket message
     * @return {Void}
     */
    requestChatList() {
        return this.socket.send(this.socket.createSocketMessage({
            method: 'getList',
            module: 'chat',
            params: [this.user.id]
        }));
    }

    /**
     * Toggle star status of a chat
     * @param  {Chat} chat
     * @return {void}
     */
    toggleStar(chat) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'star',
            'params': [chat.gid, !chat.star]
        }));
    }

    /**
     * Exit a chat
     * @param  {Chat} chat
     * @return {void}
     */
    exit(chat) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'joinchat',
            'params': [chat.gid, false]
        }));
    }

    /**
     * Query and get chat messages from local database
     * @param  {Chat} chat
     * @return {void}
     */
    getMessages(chat) {
        return this.$dao.all(`Message/${chat.gid}`);
    }
}

export default ChatApp;