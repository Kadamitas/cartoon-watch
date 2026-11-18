package tv.cartoonwatch.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.SearchManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;

public final class VoiceControls implements AutoCloseable {
    public interface Callback {
        void play();
        void pause();
        void seekTo(long positionMs);
        void fastForward();
        void rewind();
        void search(String query);
    }

    private static final long ACTIONS=PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE|PlaybackState.ACTION_STOP|PlaybackState.ACTION_SEEK_TO|PlaybackState.ACTION_FAST_FORWARD|PlaybackState.ACTION_REWIND|PlaybackState.ACTION_PLAY_FROM_SEARCH;
    private final MediaSession session;
    private final Callback callback;
    private boolean foreground=true,hasMedia,paused=true,closed;
    private long position,duration,updatedAt;
    private String title="Cartoon Watch",series="";

    public VoiceControls(Activity activity,Callback callback) {
        this.callback=callback;
        session=new MediaSession(activity,"Cartoon Watch");
        session.setPlaybackToLocal(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build());
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS|MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        Intent launch=new Intent(activity,activity.getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        session.setSessionActivity(PendingIntent.getActivity(activity,0,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop() { pause(); }
            @Override public void onSeekTo(long value) { seek(value); }
            @Override public void onFastForward() { if(usable()) { position=clamp(estimatedPosition()+10000);callback.fastForward();publish(); } }
            @Override public void onRewind() { if(usable()) { position=clamp(estimatedPosition()-10000);callback.rewind();publish(); } }
            @Override public void onPlayFromSearch(String query,Bundle extras) { if(closed)return;if(query!=null && !query.trim().isEmpty())callback.search(limit(query));else play(); }
        },new Handler(Looper.getMainLooper()));
        activity.setMediaController(session.getController());
        publish();
    }

    public void begin(String title,String series,long durationMs,long positionMs) {
        if(closed) return;
        this.title=title==null || title.isEmpty()?"Cartoon Watch":title;
        this.series=series==null?"":series;
        duration=Math.max(0,durationMs);position=clamp(positionMs);paused=true;hasMedia=true;
        metadata();session.setActive(foreground);
        session.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS).setState(PlaybackState.STATE_BUFFERING,position,0,SystemClock.elapsedRealtime()).build());
        updatedAt=SystemClock.elapsedRealtime();
    }

    public void update(long positionMs,long durationMs,boolean paused) {
        if(closed || !hasMedia) return;
        if(durationMs>0 && durationMs!=duration) { duration=durationMs;metadata(); }
        position=clamp(positionMs);
        this.paused=paused;
        publish();
    }

    public void setForeground(boolean value) {
        foreground=value;
        if(closed) return;
        session.setActive(hasMedia && value);
        if(!value) {
            if(hasMedia) { callback.pause();setState(true); }
        }
    }

    public void deactivate() {
        if(closed) return;
        hasMedia=false;paused=true;position=0;
        session.setActive(false);publish();
    }

    public boolean handleIntent(Intent intent) {
        if(closed || intent==null) return false;
        String action=intent.getAction();
        Uri data=intent.getData();
        boolean search=Intent.ACTION_SEARCH.equals(action) || MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH.equals(action);
        boolean link=Intent.ACTION_VIEW.equals(action) && data!=null && "cartoonwatch".equals(data.getScheme()) && "search".equals(data.getHost());
        if(!search && !link) return false;
        String query=link?data.getQueryParameter("q"):intent.getStringExtra(SearchManager.QUERY);
        if(query==null || query.trim().isEmpty())query=intent.getStringExtra(MediaStore.EXTRA_MEDIA_TITLE);
        if(query!=null && !query.trim().isEmpty())callback.search(limit(query));else if(hasMedia)play();
        return true;
    }

    private boolean usable() { return !closed && hasMedia && foreground; }
    private void play() {
        if(!usable()) return;
        callback.play();setState(false);
    }
    private void pause() {
        if(!usable()) return;
        callback.pause();setState(true);
    }
    private void seek(long value) { if(usable()) { position=clamp(value);callback.seekTo(position);publish(); } }
    private void setState(boolean value) { position=clamp(estimatedPosition());paused=value;publish(); }
    private long estimatedPosition() { return position+(!paused?Math.max(0,SystemClock.elapsedRealtime()-updatedAt):0); }
    private long clamp(long value) { return Math.max(0,duration>0?Math.min(duration,value):value); }
    private static String limit(String value) { return value.trim().substring(0,Math.min(180,value.trim().length())); }
    private void metadata() { session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE,title).putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE,title).putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,series).putString(MediaMetadata.METADATA_KEY_ALBUM,series).putLong(MediaMetadata.METADATA_KEY_DURATION,duration).build()); }
    private void publish() {
        updatedAt=SystemClock.elapsedRealtime();
        session.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS).setState(hasMedia?(paused?PlaybackState.STATE_PAUSED:PlaybackState.STATE_PLAYING):PlaybackState.STATE_STOPPED,clamp(position),!paused && hasMedia?1:0,updatedAt).build());
    }
    @Override public void close() { if(closed)return;deactivate();closed=true;session.release(); }
}
