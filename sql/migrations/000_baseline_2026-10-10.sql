--
-- PostgreSQL database dump
--

\restrict rhYIYpOB4P7cwV2gqvELmu7R2IdbONKPa8YxuhFbICyq11sZlyVLoUIPJUsitik

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: find_similar_tasks(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_similar_tasks(p_user_id uuid, p_title text, p_due_date date) RETURNS TABLE(id uuid, title character varying, due_date date)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.title, t.due_date
  FROM public.tasks t
  WHERE t.user_id = p_user_id
    AND t.due_date = p_due_date
    AND t.is_completed = false
    AND similarity(t.title, p_title) > 0.3
  LIMIT 3;
END;
$$;


--
-- Name: generate_link_code(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_link_code(p_user_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- 기존 미사용 코드 만료 처리
  UPDATE public.link_codes
  SET used = true
  WHERE user_id = p_user_id AND used = false;

  -- 6자리 랜덤 영숫자 코드 생성
  v_code := upper(substr(md5(random()::text), 1, 6));

  INSERT INTO public.link_codes (user_id, code, expires_at)
  VALUES (p_user_id, v_code, now() + interval '5 minutes');

  RETURN v_code;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;


--
-- Name: reset_daily_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_daily_notifications() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.tasks
  SET notified_morning = false,
      notified_evening = false
  WHERE is_completed = false
    AND due_date >= CURRENT_DATE;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: verify_link_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_link_code(p_code text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.link_codes
  WHERE code = upper(p_code)
    AND used = false
    AND expires_at > now();

  IF v_user_id IS NOT NULL THEN
    UPDATE public.link_codes
    SET used = true
    WHERE code = upper(p_code);
  END IF;

  RETURN v_user_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: archive_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archive_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid,
    user_id uuid,
    file_name character varying(255) NOT NULL,
    file_size integer,
    mime_type character varying(100),
    storage_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: archive_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archive_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title character varying(200) NOT NULL,
    content text,
    pinned boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: document_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_images (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    storage_path text,
    telegram_file_id text,
    page_order integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    uploaded_by uuid,
    title character varying(200),
    document_type character varying(30) DEFAULT 'other'::character varying,
    raw_text text,
    ai_summary text,
    source character varying(20) DEFAULT 'telegram'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: link_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.link_codes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    code character varying(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name character varying(100),
    notification_morning time without time zone DEFAULT '07:30:00'::time without time zone,
    notification_evening time without time zone DEFAULT '21:00:00'::time without time zone,
    timezone character varying(50) DEFAULT 'Asia/Seoul'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    pickup_reminder_enabled boolean DEFAULT true,
    active_term character varying(30) DEFAULT '1학년1학기'::character varying
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid,
    user_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    due_date date NOT NULL,
    due_time time without time zone,
    is_completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    memo text,
    priority character varying(10) DEFAULT 'medium'::character varying,
    category character varying(20) DEFAULT 'other'::character varying,
    notified_evening boolean DEFAULT false,
    notified_morning boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: timetable_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name character varying(100) NOT NULL,
    day character varying(3) NOT NULL,
    alert_time time without time zone NOT NULL,
    emoji character varying(10) DEFAULT '🔔'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    term character varying(30) DEFAULT '1학년1학기'::character varying,
    CONSTRAINT timetable_alerts_day_check CHECK (((day)::text = ANY ((ARRAY['mon'::character varying, 'tue'::character varying, 'wed'::character varying, 'thu'::character varying, 'fri'::character varying])::text[])))
);


--
-- Name: timetable_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    subject_id uuid,
    name character varying(50) NOT NULL,
    day character varying(3) NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    category character varying(20) DEFAULT 'school'::character varying NOT NULL,
    color character varying(10) DEFAULT '#4ECDC4'::character varying NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    term character varying(30) DEFAULT '1학년1학기'::character varying,
    CONSTRAINT timetable_blocks_day_check CHECK (((day)::text = ANY ((ARRAY['mon'::character varying, 'tue'::character varying, 'wed'::character varying, 'thu'::character varying, 'fri'::character varying])::text[])))
);


--
-- Name: timetable_pickups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_pickups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    day character varying(3) NOT NULL,
    pickup_time time without time zone NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now(),
    term character varying(30) DEFAULT '1학년1학기'::character varying,
    CONSTRAINT timetable_pickups_day_check CHECK (((day)::text = ANY ((ARRAY['mon'::character varying, 'tue'::character varying, 'wed'::character varying, 'thu'::character varying, 'fri'::character varying])::text[])))
);


--
-- Name: timetable_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name character varying(50) NOT NULL,
    color character varying(10) DEFAULT '#4ECDC4'::character varying NOT NULL,
    category character varying(20) DEFAULT 'school'::character varying NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: timetable_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name character varying(30) NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: upload_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    chat_id bigint NOT NULL,
    user_id uuid NOT NULL,
    telegram_id uuid NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    photo_file_ids text[] DEFAULT '{}'::text[],
    photo_count integer DEFAULT 0,
    last_photo_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_telegrams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_telegrams (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    chat_id bigint NOT NULL,
    display_name character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: archive_files archive_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_files
    ADD CONSTRAINT archive_files_pkey PRIMARY KEY (id);


--
-- Name: archive_posts archive_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_posts
    ADD CONSTRAINT archive_posts_pkey PRIMARY KEY (id);


--
-- Name: document_images document_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_images
    ADD CONSTRAINT document_images_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: link_codes link_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_codes
    ADD CONSTRAINT link_codes_code_key UNIQUE (code);


--
-- Name: link_codes link_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_codes
    ADD CONSTRAINT link_codes_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: timetable_alerts timetable_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_alerts
    ADD CONSTRAINT timetable_alerts_pkey PRIMARY KEY (id);


--
-- Name: timetable_alerts timetable_alerts_user_day_time_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_alerts
    ADD CONSTRAINT timetable_alerts_user_day_time_term_key UNIQUE (user_id, day, alert_time, term);


--
-- Name: timetable_blocks timetable_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_blocks
    ADD CONSTRAINT timetable_blocks_pkey PRIMARY KEY (id);


--
-- Name: timetable_pickups timetable_pickups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_pickups
    ADD CONSTRAINT timetable_pickups_pkey PRIMARY KEY (id);


--
-- Name: timetable_pickups timetable_pickups_user_day_time_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_pickups
    ADD CONSTRAINT timetable_pickups_user_day_time_term_key UNIQUE (user_id, day, pickup_time, term);


--
-- Name: timetable_subjects timetable_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_subjects
    ADD CONSTRAINT timetable_subjects_pkey PRIMARY KEY (id);


--
-- Name: timetable_terms timetable_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_terms
    ADD CONSTRAINT timetable_terms_pkey PRIMARY KEY (id);


--
-- Name: timetable_terms timetable_terms_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_terms
    ADD CONSTRAINT timetable_terms_user_id_name_key UNIQUE (user_id, name);


--
-- Name: upload_sessions upload_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_telegrams user_telegrams_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_telegrams
    ADD CONSTRAINT user_telegrams_chat_id_key UNIQUE (chat_id);


--
-- Name: user_telegrams user_telegrams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_telegrams
    ADD CONSTRAINT user_telegrams_pkey PRIMARY KEY (id);


--
-- Name: idx_archive_posts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_archive_posts_user ON public.archive_posts USING btree (user_id, created_at DESC);


--
-- Name: idx_document_images_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_images_document_id ON public.document_images USING btree (document_id);


--
-- Name: idx_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_status ON public.documents USING btree (status);


--
-- Name: idx_documents_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_user_id ON public.documents USING btree (user_id);


--
-- Name: idx_link_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_link_codes_code ON public.link_codes USING btree (code);


--
-- Name: idx_push_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions USING btree (user_id) WHERE (is_active = true);


--
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);


--
-- Name: idx_tasks_user_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_user_completed ON public.tasks USING btree (user_id, is_completed);


--
-- Name: idx_tasks_user_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_user_due ON public.tasks USING btree (user_id, due_date);


--
-- Name: idx_tasks_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_user_id ON public.tasks USING btree (user_id);


--
-- Name: idx_timetable_blocks_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_timetable_blocks_user_day ON public.timetable_blocks USING btree (user_id, day);


--
-- Name: idx_upload_sessions_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upload_sessions_chat ON public.upload_sessions USING btree (chat_id, status);


--
-- Name: idx_user_telegrams_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_telegrams_chat_id ON public.user_telegrams USING btree (chat_id);


--
-- Name: idx_user_telegrams_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_telegrams_user_id ON public.user_telegrams USING btree (user_id);


--
-- Name: tasks tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: archive_files archive_files_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_files
    ADD CONSTRAINT archive_files_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.archive_posts(id) ON DELETE CASCADE;


--
-- Name: archive_files archive_files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_files
    ADD CONSTRAINT archive_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: archive_posts archive_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_posts
    ADD CONSTRAINT archive_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: document_images document_images_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_images
    ADD CONSTRAINT document_images_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.user_telegrams(id);


--
-- Name: documents documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: link_codes link_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_codes
    ADD CONSTRAINT link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: timetable_alerts timetable_alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_alerts
    ADD CONSTRAINT timetable_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: timetable_blocks timetable_blocks_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_blocks
    ADD CONSTRAINT timetable_blocks_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.timetable_subjects(id) ON DELETE SET NULL;


--
-- Name: timetable_blocks timetable_blocks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_blocks
    ADD CONSTRAINT timetable_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: timetable_pickups timetable_pickups_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_pickups
    ADD CONSTRAINT timetable_pickups_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: timetable_subjects timetable_subjects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_subjects
    ADD CONSTRAINT timetable_subjects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: timetable_terms timetable_terms_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_terms
    ADD CONSTRAINT timetable_terms_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: upload_sessions upload_sessions_telegram_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.user_telegrams(id);


--
-- Name: upload_sessions upload_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_telegrams user_telegrams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_telegrams
    ADD CONSTRAINT user_telegrams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: app_settings Authenticated users can read settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read settings" ON public.app_settings FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: link_codes Users can create own link codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own link codes" ON public.link_codes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: documents Users can manage own documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own documents" ON public.documents USING ((auth.uid() = user_id));


--
-- Name: push_subscriptions Users can manage own subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own subscriptions" ON public.push_subscriptions USING ((auth.uid() = user_id));


--
-- Name: tasks Users can manage own tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own tasks" ON public.tasks USING ((auth.uid() = user_id));


--
-- Name: user_telegrams Users can manage own telegrams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own telegrams" ON public.user_telegrams USING ((auth.uid() = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: document_images Users can view own document images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own document images" ON public.document_images FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.documents
  WHERE ((documents.id = document_images.document_id) AND (documents.user_id = auth.uid())))));


--
-- Name: documents Users can view own documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own documents" ON public.documents FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: link_codes Users can view own link codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own link codes" ON public.link_codes FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: tasks Users can view own tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own tasks" ON public.tasks FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_telegrams Users can view own telegrams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own telegrams" ON public.user_telegrams FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: timetable_alerts Users manage own alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own alerts" ON public.timetable_alerts USING ((auth.uid() = user_id));


--
-- Name: timetable_blocks Users manage own blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own blocks" ON public.timetable_blocks USING ((auth.uid() = user_id));


--
-- Name: archive_files Users manage own files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own files" ON public.archive_files USING ((auth.uid() = user_id));


--
-- Name: timetable_pickups Users manage own pickups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own pickups" ON public.timetable_pickups USING ((auth.uid() = user_id));


--
-- Name: archive_posts Users manage own posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own posts" ON public.archive_posts USING ((auth.uid() = user_id));


--
-- Name: timetable_subjects Users manage own subjects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own subjects" ON public.timetable_subjects USING ((auth.uid() = user_id));


--
-- Name: timetable_terms Users manage own terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own terms" ON public.timetable_terms USING ((auth.uid() = user_id));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: archive_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.archive_files ENABLE ROW LEVEL SECURITY;

--
-- Name: archive_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.archive_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: document_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_images ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: link_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.link_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: timetable_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: timetable_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: timetable_pickups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_pickups ENABLE ROW LEVEL SECURITY;

--
-- Name: timetable_subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: timetable_terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: upload_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.upload_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_telegrams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_telegrams ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict rhYIYpOB4P7cwV2gqvELmu7R2IdbONKPa8YxuhFbICyq11sZlyVLoUIPJUsitik

